export interface Post {
  id: number;
  author: string;
  content: string;
  likes: number;
  comments: number;
  shares: number;
  likedByUser?: boolean; // track if current user liked
  isNew?: boolean;       // optional flag for new posts
  fadingOut?: boolean;
}