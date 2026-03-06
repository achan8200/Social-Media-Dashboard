import * as functions from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

// Trigger when a like is added
export const onLikeCreate = functions.onDocumentCreated(
  {document: "posts/{postId}/likes/{userId}"},
  async (event) => {
    const postId = event.params.postId;
    const postRef = db.collection("posts").doc(postId);

    await postRef.update({
      likesCount: admin.firestore.FieldValue.increment(1),
    });
  }
);

// Trigger when a like is removed
export const onLikeDelete = functions.onDocumentDeleted(
  {document: "posts/{postId}/likes/{userId}"},
  async (event) => {
    const postId = event.params.postId;
    const postRef = db.collection("posts").doc(postId);

    await postRef.update({
      likesCount: admin.firestore.FieldValue.increment(-1),
    });
  }
);
