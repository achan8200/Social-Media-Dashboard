import { Injectable, inject } from '@angular/core';
import { Auth, deleteUser, EmailAuthProvider, reauthenticateWithCredential } from '@angular/fire/auth';
import { Firestore, collection, query, where, getDocs, deleteDoc, doc, getDoc, orderBy, updateDoc } from '@angular/fire/firestore';
import { Storage, ref, deleteObject, listAll } from '@angular/fire/storage';
import { PostsService } from './posts.service';
import { MessagesService } from './messages.service';
import { GroupsService } from './groups.service';

@Injectable({ providedIn: 'root' })
export class AccountService {
  private auth = inject(Auth);
  private firestore = inject(Firestore);
  private storage = inject(Storage);

  constructor(
    private postsService: PostsService,
    private messagesService: MessagesService,
    private groupsService: GroupsService,
  ) {}

  async deleteAccount(password: string) {
    const user = this.auth.currentUser;

    if (!user || !user.email) {
      throw new Error('User not authenticated');
    }

    // Reauthenticate first
    const credential = EmailAuthProvider.credential(
      user.email,
      password
    );

    await reauthenticateWithCredential(user, credential);

    // Cleanup app data
    await this.cleanupUserData(user.uid);

    // Delete auth account
    await deleteUser(user);
  }

  private async cleanupUserData(uid: string) {
    await this.deleteUserPosts(uid);
    await this.deleteUserNotifications(uid);
    await this.anonymizeMessages(uid);
    await this.cleanupThreads(uid);
    await this.cleanupLikes(uid);
    await this.cleanupComments(uid);
    await this.cleanupConnections(uid);
    await this.cleanupGroups(uid);
    await this.deleteUserStorage(uid);

    // Delete user profile document
    await deleteDoc(doc(this.firestore, `users/${uid}`));
  }

  private async deleteUserPosts(uid: string) {
    const postsRef = collection(this.firestore, 'posts');

    const q = query(postsRef, where('uid', '==', uid));

    const snapshot = await getDocs(q);

    for (const docSnap of snapshot.docs) {
      const post = {
        id: docSnap.id,
        ...docSnap.data()
      } as any;

      await this.postsService.deletePost(post);
    }
  }

  private async deleteUserNotifications(uid: string) {
    const ref = collection(this.firestore, 'notifications');

    const recipientQuery = query(
      ref,
      where('recipientUid', '==', uid)
    );

    const actorQuery = query(
      ref,
      where('actorUid', '==', uid)
    );

    const [recipientSnap, actorSnap] = await Promise.all([
      getDocs(recipientQuery),
      getDocs(actorQuery)
    ]);

    const allDocs = [
      ...recipientSnap.docs,
      ...actorSnap.docs
    ];

    const unique = new Map();

    allDocs.forEach(d => unique.set(d.id, d));

    for (const d of unique.values()) {
      await deleteDoc(d.ref);
    }
  }

  private async anonymizeMessages(uid: string) {

    // ─────────────────────────────
    // Regular Threads
    // ─────────────────────────────
    const threadsRef = collection(this.firestore, 'threads');

    const threadsQuery = query(
      threadsRef,
      where('participants', 'array-contains', uid)
    );

    const threadsSnap = await getDocs(threadsQuery);

    for (const threadDoc of threadsSnap.docs) {

      const messagesRef = collection(
        this.firestore,
        `threads/${threadDoc.id}/messages`
      );

      const messagesQuery = query(
        messagesRef,
        where('senderId', '==', uid)
      );

      const messagesSnap = await getDocs(messagesQuery);

      for (const msgDoc of messagesSnap.docs) {
        await updateDoc(msgDoc.ref, {
          senderName: 'Deleted User'
        });
      }

      // Update last message preview if needed
      const threadData = threadDoc.data();

      if (threadData['lastMessage']?.senderId === uid) {
        await updateDoc(threadDoc.ref, {
          'lastMessage.senderName': 'Deleted User'
        });
      }
    }

    // ─────────────────────────────
    // Group Threads
    // ─────────────────────────────
    const userGroupsRef = collection(
      this.firestore,
      `users/${uid}/groups`
    );

    const userGroupsSnap = await getDocs(userGroupsRef);

    for (const groupDoc of userGroupsSnap.docs) {

      const groupId = groupDoc.id;

      const threadRef = doc(
        this.firestore,
        `groupThreads/${groupId}`
      );

      const threadSnap = await getDoc(threadRef);

      if (!threadSnap.exists()) {
        continue;
      }

      const messagesRef = collection(
        this.firestore,
        `groupThreads/${groupId}/messages`
      );

      const messagesQuery = query(
        messagesRef,
        where('senderId', '==', uid)
      );

      const messagesSnap = await getDocs(messagesQuery);

      for (const msgDoc of messagesSnap.docs) {
        await updateDoc(msgDoc.ref, {
          senderName: 'Deleted User'
        });
      }

      const threadData = threadSnap.data();

      if (threadData['lastMessage']?.senderId === uid) {
        await updateDoc(threadRef, {
          'lastMessage.senderName': 'Deleted User'
        });
      }
    }
  }

  private async cleanupThreads(uid: string) {
    const ref = collection(this.firestore, 'threads');

    const q = query(
      ref,
      where('participants', 'array-contains', uid)
    );

    const snapshot = await getDocs(q);

    for (const threadDoc of snapshot.docs) {
      const data = threadDoc.data();
      const participants = data['participants'] || [];

      // Delete 1-on-1 thread entirely
      if (participants.length <= 2) {
        await this.messagesService.deleteThread(threadDoc.id);
      }
      else {
        // Remove user from group thread
        await this.messagesService.removeParticipant(
          threadDoc.id,
          uid
        );
      }
    }
  }

  private async cleanupLikes(uid: string) {
    const postsRef = collection(this.firestore, 'posts');

    const postsSnap = await getDocs(postsRef);

    for (const postDoc of postsSnap.docs) {
      const likeRef = doc(
        this.firestore,
        `posts/${postDoc.id}/likes/${uid}`
      );

      try {
        await deleteDoc(likeRef);
      } catch {}
    }
  }

  private async cleanupComments(uid: string) {
    const postsRef = collection(this.firestore, 'posts');

    const postsSnap = await getDocs(postsRef);

    for (const postDoc of postsSnap.docs) {
      const commentsRef = collection(
        this.firestore,
        `posts/${postDoc.id}/comments`
      );

      const q = query(commentsRef, where('uid', '==', uid));

      const commentsSnap = await getDocs(q);

      for (const commentDoc of commentsSnap.docs) {
        await this.postsService.deleteComment(
          postDoc.id,
          commentDoc.id
        );
      }
    }
  }

  private async cleanupConnections(uid: string) {

    // ─────────────────────────────
    // Remove followers
    // users/{uid}/followers/*
    // ─────────────────────────────
    const followersRef = collection(
      this.firestore,
      `users/${uid}/followers`
    );

    const followersSnap = await getDocs(followersRef);

    for (const followerDoc of followersSnap.docs) {

      const followerUid = followerDoc.id;

      // Remove reverse following doc
      await deleteDoc(
        doc(
          this.firestore,
          `users/${followerUid}/following/${uid}`
        )
      );

      // Remove follower doc
      await deleteDoc(followerDoc.ref);
    }

    // ─────────────────────────────
    // Remove following
    // users/{uid}/following/*
    // ─────────────────────────────
    const followingRef = collection(
      this.firestore,
      `users/${uid}/following`
    );

    const followingSnap = await getDocs(followingRef);

    for (const followingDoc of followingSnap.docs) {

      const targetUid = followingDoc.id;

      // Remove reverse follower doc
      await deleteDoc(
        doc(
          this.firestore,
          `users/${targetUid}/followers/${uid}`
        )
      );

      // Remove following doc
      await deleteDoc(followingDoc.ref);
    }
  }

  private async cleanupGroups(uid: string) {
    const userGroupsRef = collection(
      this.firestore,
      `users/${uid}/groups`
    );

    const userGroupsSnap = await getDocs(userGroupsRef);

    for (const groupDoc of userGroupsSnap.docs) {
      const groupId = groupDoc.id;

      const memberRef = doc(
        this.firestore,
        `groups/${groupId}/members/${uid}`
      );

      const memberSnap = await getDoc(memberRef);

      if (!memberSnap.exists()) {
        continue;
      }

      const memberData = memberSnap.data();
      const role = memberData['role'];

      // ─────────────────────────────
      // Owner Logic
      // ─────────────────────────────
      if (role === 'owner') {

        const membersRef = collection(
          this.firestore,
          `groups/${groupId}/members`
        );

        const membersQuery = query(
          membersRef,
          orderBy('joinedAt', 'asc')
        );

        const membersSnap = await getDocs(membersQuery);

        // Exclude deleting user
        const remainingMembers = membersSnap.docs.filter(
          d => d.id !== uid
        );

        // No members left -> delete group
        if (remainingMembers.length === 0) {
          await this.groupsService.deleteGroup(groupId);
          continue;
        }

        // Transfer ownership to earliest remaining member
        const nextOwnerUid = remainingMembers[0].id;

        await this.groupsService.transferOwnership(
          groupId,
          uid,
          nextOwnerUid
        );

        // Remove old owner from group
        await this.groupsService.leaveGroup(groupId);
      }

      // ─────────────────────────────
      // Moderator / Member Logic
      // ─────────────────────────────
      else {
        await this.groupsService.leaveGroup(groupId);
      }
    }
  }

  private async deleteUserStorage(uid: string) {
    try {
      const storageRef = ref(this.storage, `post-media/${uid}`);

      const files = await listAll(storageRef);

      for (const item of files.items) {
        await deleteObject(item);
      }
    }
    catch (err) {
      console.warn('Failed deleting storage', err);
    }
  }
}