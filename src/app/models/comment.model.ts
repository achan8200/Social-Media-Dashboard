import { Observable } from 'rxjs';

export interface CommentWithLikes extends Comment {
  liked$: Observable<boolean>;
  username$?: Observable<string>;
  userAvatar$?: Observable<string | null>;
}

export interface Comment {
  id?: string;
  uid: string;
  text: string;
  createdAt: any;
  updatedAt?: any;

  username?: string;
  userId?: string;
  displayName?: string;
  userAvatar?: string | null;

  likesCount?: number;
}