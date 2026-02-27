export interface PostMedia {
  url: string;
  type: 'image' | 'video';
  width?: number;
  height?: number;
  duration?: number;
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

  createdAt: any;
  updatedAt?: any;

  // UI-only
  isNew?: boolean;
  fadingOut?: boolean;
}