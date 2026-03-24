import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Firestore, collection, getDocs, query, where } from '@angular/fire/firestore';
import { AuthService } from '../../services/auth.service';
import { FollowService } from '../../services/follow.service';
import { UserService } from '../../services/user.service';
import { Avatar } from '../../components/avatar/avatar';
import { firstValueFrom, Observable, map, Subject, takeUntil } from 'rxjs';

interface ObservableUser {
  uid: string;
  username$: Observable<string>;
  displayName$: Observable<string>;
  profilePicture$: Observable<string | null>;
  userId$: Observable<string>;
  following$: Observable<boolean>;

  // cache for immediate render
  following?: boolean;
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

  private loadFollowersAndFollowing() {
    if (!this.profileUserId) return;

    this.followService.getFollowers(this.profileUserId)
      .pipe(takeUntil(this.destroy$))
      .subscribe(async rawFollowers => {
        this.followers = await this.mapUsersToObservables(rawFollowers);
        if (this.activeTab === 'followers') this.users = this.followers;
        this.cdr.detectChanges();
      });

    this.followService.getFollowing(this.profileUserId)
      .pipe(takeUntil(this.destroy$))
      .subscribe(async rawFollowing => {
        this.following = await this.mapUsersToObservables(rawFollowing);
        if (this.activeTab === 'following') this.users = this.following;
        this.cdr.detectChanges();
      });
  }

  private mapUsersToObservables(rawUsers: any[]): ObservableUser[] {
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

        following$: this.currentUserId
        ? this.followService.isFollowing$(this.currentUserId, u.uid)
        : new Observable<boolean>(sub => sub.next(false)),

        usernameCache: u.username,
        displayNameCache: u.displayName,
        profilePictureCache: u.profilePicture,

        following: undefined
      };

      observableUser.following$
        .pipe(takeUntil(this.destroy$))
        .subscribe(val => {
          observableUser.following = val;
          this.cdr.markForCheck();
        });

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
  }

  // Unfollow a user (used in Following tab)
  async unfollow(uid: string) {
    if (!this.currentUserId) return;
    await this.followService.unfollowUser(this.currentUserId, uid);
  }

  // Remove a follower (used in Followers tab)
  async removeFollower(followerUid: string) {
    if (!this.currentUserId) return;
    await this.followService.removeFollower(this.currentUserId, followerUid);
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
