import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Firestore, collection, getDocs, query, where, documentId } from '@angular/fire/firestore';
import { AuthService } from '../../services/auth.service';
import { Avatar } from '../../components/avatar/avatar';
import { firstValueFrom } from 'rxjs';
import { FollowService } from '../../services/follow.service';

@Component({
  selector: 'app-connections',
  standalone: true,
  imports: [CommonModule, Avatar],
  templateUrl: './connections.html',
  styleUrl: './connections.css'
})
export class Connections implements OnInit {
  private firestore = inject(Firestore);
  private route = inject(ActivatedRoute);
  private authService = inject(AuthService);
  private followService = inject(FollowService);
  private cdr = inject(ChangeDetectorRef);

  activeTab: 'followers' | 'following' = 'followers';
  followers: any[] = [];
  following: any[] = [];
  users: any[] = [];
  profileUserId: string | null = null;
  currentUserId: string | null = null;
  isOwnProfile: boolean = false;

  async ngOnInit() {
    const authUser = await firstValueFrom(this.authService.getCurrentUser());
    if (!authUser) return;
    this.currentUserId = authUser.uid;

    await this.loadProfile();
    await this.loadFollowersAndFollowing();
    
    // Determine if viewing own profile
    this.isOwnProfile = this.profileUserId === this.currentUserId;

    // Initialize active tab users after all data is ready
    this.switchTab(this.activeTab);
  }

  private async loadProfile() {
    const params = this.route.snapshot.paramMap;
    const username = params.get('username');

    if (username) {
      // Public profile
      const usersRef = collection(this.firestore, 'users');
      const q = query(usersRef, where('username', '==', username));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        this.profileUserId = snapshot.docs[0].id;
      }
    } else {
      // Own profile
      this.profileUserId = this.currentUserId;
    }
  }

  private async loadFollowersAndFollowing() {
    if (!this.profileUserId || !this.currentUserId) return;
    [this.followers, this.following] = await Promise.all([
      this.loadSubcollection('followers'),
      this.loadSubcollection('following')
    ]);
  }

  private async loadSubcollection(sub: 'followers' | 'following'): Promise<any[]> {
    const ref = collection(this.firestore, `users/${this.profileUserId}/${sub}`);
    const snapshot = await getDocs(ref);
    if (!snapshot || snapshot.empty) return [];

    const userIds = snapshot.docs.map(doc => doc.id);
    const chunks = this.chunkArray(userIds, 10);
    const result: any[] = [];

    for (const chunk of chunks) {
      const usersRef = collection(this.firestore, 'users');
      const q = query(usersRef, where(documentId(), 'in', chunk));
      const userSnap = await getDocs(q);

      for (const doc of userSnap.docs) {
        const data: any = doc.data();
        const uid = doc.id;
        const following = await this.followService.isFollowing(this.currentUserId!, uid).toPromise();

        result.push({
          uid,
          userId: data.userId,
          displayName: data.displayName,
          username: data.username,
          profilePicture: data.profilePicture,
          following
        });
      }
    }

    return result;
  }

  async loadConnections() {
    if (!this.profileUserId || !this.currentUserId) return;

    // Clear previous users immediately
    this.users = [];
    this.cdr.detectChanges(); // make sure UI updates

    const subcollection = this.activeTab === 'followers' ? 'followers' : 'following';
    const ref = collection(this.firestore, `users/${this.profileUserId}/${subcollection}`);
    const snapshot = await getDocs(ref);

    // If subcollection doesn't exist or is empty, just return empty list
    if (!snapshot || snapshot.empty) {
      this.users = [];
      this.cdr.detectChanges();
      return;
    }

    const userIds = snapshot.docs.map(doc => doc.id);
    const chunks = this.chunkArray(userIds, 10);
    const users: any[] = [];

    for (const chunk of chunks) {
      const usersRef = collection(this.firestore, 'users');
      const q = query(usersRef, where(documentId(), 'in', chunk));
      const userSnap = await getDocs(q);

      for (const doc of userSnap.docs) {
        const data: any = doc.data();
        const uid = doc.id;

        // Check if the current user is following this user
        const following = await this.followService
          .isFollowing(this.currentUserId, uid)
          .toPromise();

        users.push({
          uid,
          userId: data.userId,
          displayName: data.displayName,
          username: data.username,
          profilePicture: data.profilePicture,
          following
        });
      }
    }

    this.users = users;
    this.cdr.detectChanges();
  }

  async switchTab(tab: 'followers' | 'following') {
    this.activeTab = tab;
    this.users = tab === 'followers' ? this.followers : this.following;
    this.cdr.detectChanges();
  }

  // Follow a user (used in Followers tab)
  async follow(uid: string) {
    if (!this.currentUserId) return;
    await this.followService.followUser(this.currentUserId, uid);
    // Update local state
    const user = this.users.find(u => u.uid === uid);
    if (user) user.following = true;

    // optionally update the following list
    const followingUser = this.following.find(u => u.uid === uid);
    if (!followingUser) {
      this.following.push({ ...user });
    }

    this.cdr.detectChanges();
  }

  // Unfollow a user (used in Following tab)
  async unfollow(uid: string) {
    if (!this.currentUserId) return;
    console.log("Current user id: ", this.currentUserId);
    console.log("User id: ", uid);
    await this.followService.unfollowUser(this.currentUserId, uid);
    
    // remove from local following list
    this.following = this.following.filter(u => u.uid !== uid);

    // update followers list if active tab is followers
    const follower = this.followers.find(u => u.uid === uid);
    if (follower) follower.following = false;

    this.users = this.activeTab === 'followers' ? this.followers : this.following;
    this.cdr.detectChanges();
  }

  // Remove a follower (used in Followers tab)
  async removeFollower(uid: string) {
    if (!this.currentUserId) return;
    console.log("Current user id: ", this.currentUserId);
    console.log("User id: ", uid);
    await this.followService.unfollowUser(this.currentUserId, uid);
    
    // Remove from local Followers list
    this.users = this.users.filter(u => u.uid !== uid);

    
    this.cdr.detectChanges();
  }

  private chunkArray(array: string[], size: number) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
