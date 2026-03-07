import { Observable } from 'rxjs';

export interface CommentWithLikes extends Comment {
  liked$: Observable<boolean>;
}

export interface Comment {
  id?: string;
  uid: string;
  text: string;
  createdAt: any;
  updatedAt?: any;

  username?: string;
  displayName?: string;
  userAvatar?: string | null;

  likesCount?: number;
}