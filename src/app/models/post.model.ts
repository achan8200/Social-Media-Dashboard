export interface PostMedia {
  url: string;
  path: string;
  type: 'image' | 'video';
  width?: number;
  height?: number;
  duration?: number;
  thumbnail?: string;
}

export interface Post {
  id: string; // Firestore doc id

  uid: string;       // Firebase Auth UID
  userId: number;    // Your sequential public ID

  username: string;
  displayName: string;
  userAvatar?: string;

  caption?: string;
  media?: PostMedia[];

  likesCount: number;
  commentsCount: number;

  likedByUser?: boolean;

  createdAt: any;
  updatedAt?: any;

  // UI-only
  isNew?: boolean;
  fadingOut?: boolean;

  pending?: boolean;
}