export interface Message {
  id?: string;
  senderId: string;
  text: string;
  createdAt: any;
  readBy?: string[]; // Array of user IDs who have read this message
}

export interface Thread {
  id: string;
  participants: string[];
  participantDetails?: { 
    uid: string; 
    username?: string; 
    displayName?: string; 
    profilePicture?: string 
  }[];
  lastMessage?: Message;
  lastMessageAt?: any;
  unreadCount?: number;
  typing?: { [uid: string]: boolean };

  groupName?: string;
}