export interface Notification {
  id?: string;
  recipientUid: string;
  actorUid: string;
  type: string;

  postId?: string;
  commentId?: string;
  threadId?: string;

  createdAt: any;
  read: boolean;
}