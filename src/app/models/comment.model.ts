export interface Comment {
  id?: string;
  uid: string;
  text: string;
  createdAt: any;
  updatedAt?: any;

  username?: string;
  displayName?: string;
  userAvatar?: string | null;
}