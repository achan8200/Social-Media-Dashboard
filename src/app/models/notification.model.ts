export interface Notification {
  id?: string;

  recipientUid: string;
  actorUid: string;
  
  type:
    | 'like_post'
    | 'comment_post'
    | 'like_comment'
    | 'follow'
    | 'message'
    | 'thread_added'
    | 'group_invite';

  postId?: string;
  commentId?: string;
  threadId?: string;
  groupId?: string;

  createdAt: any;
  read: boolean;
}