import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Firestore, collection, getDocs, query, where, documentId, orderBy } from '@angular/fire/firestore';
import { AuthService } from '../../services/auth.service';
import { Avatar } from '../../components/avatar/avatar';
import { firstValueFrom, Observable, map, Subject, takeUntil } from 'rxjs';
import { FollowService } from '../../services/follow.service';
import { UserService } from '../../services/user.service';

interface ObservableUser {
  uid: string;
  username$: Observable<string>;
  displayName$: Observable<string>;
  profilePicture$: Observable<string | null>;
  userId$: Observable<string>;
  following: boolean;

  // cache for immediate render
  usernameCache?: string;
  displayNameCache?: string;
  profilePictureCache?: string | null;
}

@Component({
  selector: 'app-connections',
  standalone: true,
  imports: [CommonModule, RouterModule, Avatar],
  templateUrl: './connections.html',
  styleUrl: './connections.css'
})
export class Connections implements OnInit, OnDestroy {
  private firestore = inject(Firestore);
  private route = inject(ActivatedRoute);
  private authService = inject(AuthService);
  private followService = inject(FollowService);
  private userService = inject(UserService);
  private cdr = inject(ChangeDetectorRef);

  activeTab: 'followers' | 'following' = 'followers';
  followers: ObservableUser[] = [];
  following: ObservableUser[] = [];
  users: ObservableUser[] = [];

  profileUserId: string | null = null;
  currentUserId: string | null = null;
  isOwnProfile: boolean = false;
  profileUsername$: Observable<string> | null = null;

  private destroy$ = new Subject<void>();

  async ngOnInit() {
    const authUser = await firstValueFrom(this.authService.getCurrentUser());
    if (authUser) this.currentUserId = authUser.uid;

    await this.loadProfile();
    await this.loadFollowersAndFollowing();

    this.isOwnProfile = this.profileUserId === this.currentUserId;

    this.route.queryParamMap.subscribe(params => {
      const tab = params.get('tab');
      this.activeTab = tab === 'following' ? 'following' : 'followers';
      this.users = this.activeTab === 'followers' ? this.followers : this.following;
      this.cdr.detectChanges();
    });

    // Patch followers
    this.followers.forEach(u => {
      u.username$.pipe(takeUntil(this.destroy$)).subscribe(name => u.usernameCache = name);
      u.displayName$.pipe(takeUntil(this.destroy$)).subscribe(name => u.displayNameCache = name);
      u.profilePicture$.pipe(takeUntil(this.destroy$)).subscribe(url => u.profilePictureCache = url);
    });

    // Patch following
    this.following.forEach(u => {
      u.username$.pipe(takeUntil(this.destroy$)).subscribe(name => u.usernameCache = name);
      u.displayName$.pipe(takeUntil(this.destroy$)).subscribe(name => u.displayNameCache = name);
      u.profilePicture$.pipe(takeUntil(this.destroy$)).subscribe(url => u.profilePictureCache = url);
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
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

    // Determine if viewing own profile
    this.isOwnProfile = this.profileUserId === this.currentUserId;

    // Only fetch username observable for header if not own profile
    if (!this.isOwnProfile && this.profileUserId) {
      this.profileUsername$ = this.userService.getUserByUid(this.profileUserId).pipe(
        map(user => user?.username ?? 'Unknown')
      );
    }
  }

  private async loadFollowersAndFollowing() {
  if (!this.profileUserId) return;

  const [rawFollowers, rawFollowing] = await Promise.all([
    this.loadSubcollection('followers'),
    this.loadSubcollection('following')
  ]);

  this.followers = await this.mapUsersToObservables(rawFollowers);
  this.following = await this.mapUsersToObservables(rawFollowing);

  [this.followers, this.following].forEach(list => {
    list.forEach(u => {
      u.usernameCache = u.usernameCache || u.usernameCache;
      u.displayNameCache = u.displayNameCache || u.displayNameCache;
      u.profilePictureCache = u.profilePictureCache || u.profilePictureCache;
    });
  });

  // Assign users from the exact same array reference
  this.users = this.activeTab === 'followers' ? this.followers : this.following;

  this.cdr.detectChanges();
}

  private async loadSubcollection(sub: 'followers' | 'following'): Promise<any[]> {
    if (!this.profileUserId) return [];
    const ref = collection(this.firestore, `users/${this.profileUserId}/${sub}`);
    const q = query(ref, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    if (!snapshot || snapshot.empty) return [];

    const entries = snapshot.docs.map(doc => ({
      uid: doc.id,
      createdAt: doc.data()['createdAt']
    }));

    const userIds = entries.map(e => e.uid);
    const chunks = this.chunkArray(userIds, 10);
    const result: any[] = [];

    for (const chunk of chunks) {
      const usersRef = collection(this.firestore, 'users');
      const q = query(usersRef, where(documentId(), 'in', chunk));
      const userSnap = await getDocs(q);

      for (const doc of userSnap.docs) {
        const data: any = doc.data();
        const uid = doc.id;

        const entry = entries.find(e => e.uid === uid);

        let following = false;
        if (this.currentUserId) {
          following = (await firstValueFrom(this.followService.isFollowing(this.currentUserId, uid))) ?? false;
        }

        result.push({
          uid,
          createdAt: entry?.createdAt,
          userId: data.userId,
          displayName: data.displayName,
          username: data.username,
          profilePicture: data.profilePicture,
          following
        });
      }
    }
    result.sort((a, b) => {
      const aTime = a.createdAt?.toMillis?.() ?? 0;
      const bTime = b.createdAt?.toMillis?.() ?? 0;
      return bTime - aTime;
    });

    return result;
  }

  private async mapUsersToObservables(rawUsers: any[]): Promise<ObservableUser[]> {
    return rawUsers.map(u => {
      const user$ = this.userService.getUserByUid(u.uid);

      const observableUser: ObservableUser = {
        uid: u.uid,
        username$: user$.pipe(map(user => {
          observableUser.usernameCache = user?.username || 'Unknown';
          return observableUser.usernameCache;
        })),
        displayName$: user$.pipe(map(user => {
          observableUser.displayNameCache = user?.displayName || 'Unknown';
          return observableUser.displayNameCache;
        })),
        profilePicture$: user$.pipe(map(user => {
          observableUser.profilePictureCache = user?.profilePicture || null;
          return observableUser.profilePictureCache;
        })),
        userId$: user$.pipe(map(user => user?.userId || '')),
        following: u.following,
        usernameCache: u.username,
        displayNameCache: u.displayName,
        profilePictureCache: u.profilePicture
      };

      return observableUser;
    });
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
    if (!this.following.find(u => u.uid === uid)) {
      this.following.push({ ...user } as ObservableUser);
    }
    this.cdr.detectChanges();
  }

  // Unfollow a user (used in Following tab)
  async unfollow(uid: string) {
    if (!this.currentUserId) return;
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
  async removeFollower(followerUid: string) {
    if (!this.currentUserId) return;
    await this.followService.removeFollower(this.currentUserId, followerUid);

    // Optimistically update local followers list
    this.followers = this.followers.filter(u => u.uid !== followerUid);

    // Update the displayed users based on active tab
    this.users = this.activeTab === 'followers' ? this.followers : this.following;
    this.cdr.detectChanges();
  }

  private chunkArray(array: string[], size: number) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  trackByUid(index: number, user: ObservableUser) {
    return user.uid;
  }
}
