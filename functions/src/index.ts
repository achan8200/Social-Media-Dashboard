import * as firestore from "firebase-functions/v2/firestore";
import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

// --------------------
// Firestore triggers
// --------------------

// Trigger when a like is added
export const onLikeCreate = firestore.onDocumentCreated(
  "posts/{postId}/likes/{userId}",
  async (event) => {
    const postId = event.params.postId;
    const postRef = db.collection("posts").doc(postId);

    await postRef.update({
      likesCount: admin.firestore.FieldValue.increment(1),
    });
  }
);

// Trigger when a like is removed
export const onLikeDelete = firestore.onDocumentDeleted(
  "posts/{postId}/likes/{userId}",
  async (event) => {
    const postId = event.params.postId;
    const postRef = db.collection("posts").doc(postId);

    await postRef.update({
      likesCount: admin.firestore.FieldValue.increment(-1),
    });
  }
);

// --------------------
// Remove follower (callable v2)
// --------------------

export const removeFollower = onCall(
  async (
    request: CallableRequest<{
      profileUid: string;
      followerUid: string;
    }>
  ) => {
    const {data, auth} = request;

    if (!auth?.uid) {
      throw new HttpsError(
        "unauthenticated",
        "User must be logged in."
      );
    }

    const uid = auth.uid;
    const {profileUid, followerUid} = data;

    if (!profileUid || !followerUid) {
      throw new HttpsError(
        "invalid-argument",
        "Missing profileUid or followerUid."
      );
    }

    if (uid !== profileUid) {
      throw new HttpsError(
        "permission-denied",
        "Only profile owner can remove a follower."
      );
    }

    const batch = db.batch();

    const followerRef = db
      .collection("users")
      .doc(profileUid)
      .collection("followers")
      .doc(followerUid);

    const followingRef = db
      .collection("users")
      .doc(followerUid)
      .collection("following")
      .doc(profileUid);

    batch.delete(followerRef);
    batch.delete(followingRef);

    await batch.commit();

    return {success: true};
  }
);

// --------------------
// Interest decay scheduler
// --------------------

export const decayUserInterests = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "UTC",
  },
  async () => {
    const usersSnap = await db.collection("users").get();

    for (const userDoc of usersSnap.docs) {
      const interestsSnap = await userDoc.ref.collection("interests").get();

      if (interestsSnap.empty) continue;

      const batch = db.batch();

      interestsSnap.docs.forEach((doc) => {
        const data = doc.data();
        const oldScore = data["score"] ?? 0;

        const newScore = Math.max(
          0,
          Number((oldScore * 0.97).toFixed(2))
        );

        if (newScore < 0.25) {
          batch.delete(doc.ref);
        } else {
          batch.update(doc.ref, {
            score: newScore,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      });

      await batch.commit();
    }

    console.log("Interest decay completed.");
  }
);
