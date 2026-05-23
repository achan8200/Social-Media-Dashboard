export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: any;
  readBy: string[]; // Array of user IDs who have read this message
  type: 'text' | 'system';
  isEdited?: boolean;
  isDeleted?: boolean;
  reactions?: Record<string, string>;
  replyTo?: MessageReply | null;
}

export interface MessageReply {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  isDeleted?: boolean;
  isEdited?: boolean;
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