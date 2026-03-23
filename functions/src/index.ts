import * as firestore from "firebase-functions/v2/firestore";
import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
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
