import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Firestore, collection, getDocs, query, where } from '@angular/fire/firestore';
import { AuthService } from '../../services/auth.service';
import { FollowService } from '../../services/follow.service';
import { UserService } from '../../services/user.service';
import { Avatar } from '../../components/avatar/avatar';
import { firstValueFrom, Observable, map, Subject, takeUntil, BehaviorSubject, combineLatest } from 'rxjs';

interface ObservableUser {
  uid: string;
  username$: Observable<string>;
  displayName$: Observable<string>;
  profilePicture$: Observable<string | null>;
  userId$: Observable<string>;

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

  followers$ = new BehaviorSubject<ObservableUser[]>([]);
  following$ = new BehaviorSubject<ObservableUser[]>([]);
  private followingSet = new Set<string>();

  profileUserId: string | null = null;
  currentUserId: string | null = null;
  isOwnProfile: boolean = false;
  profileUsername$: Observable<string> | null = null;

  private tabSubject = new BehaviorSubject<'followers' | 'following'>('followers');
  private searchSubject = new BehaviorSubject<string>('');

  tab$ = this.tabSubject.asObservable();
  search$ = this.searchSubject.asObservable();

  private destroy$ = new Subject<void>();

  connections$ = combineLatest([
    this.tab$,
    this.search$,
    this.followers$,
    this.following$
  ]).pipe(
    map(([tab, search, followers, following]) => {
      const base = tab === 'followers' ? followers : following;

      const term = search.toLowerCase().trim();

      if (!term) return base;

      return base.filter(user => {
        const username = (user.usernameCache || '').toLowerCase();
        const displayName = (user.displayNameCache || '').toLowerCase();

        return username.includes(term) || displayName.includes(term);
      });
    })
  );

  async ngOnInit() {
    const authUser = await firstValueFrom(this.authService.getCurrentUser());
    if (authUser) this.currentUserId = authUser.uid;

    if (this.currentUserId) {
      this.followService.getFollowing(this.currentUserId)
        .pipe(takeUntil(this.destroy$))
        .subscribe(list => {
          this.followingSet = new Set(list.map(u => u.uid));

          // Update existing users instantly
          this.updateFollowingState();
        });
    }

    await this.loadProfile();
    await this.loadFollowersAndFollowing();

    this.isOwnProfile = this.profileUserId === this.currentUserId;

    this.route.queryParamMap.subscribe(params => {
      const tab = params.get('tab') === 'following' ? 'following' : 'followers';
      this.tabSubject.next(tab);
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
        const mapped = await this.mapUsersToObservables(rawFollowers);
        mapped.forEach(u => {
          u.username$.pipe(takeUntil(this.destroy$)).subscribe(name => u.usernameCache = name);
          u.displayName$.pipe(takeUntil(this.destroy$)).subscribe(name => u.displayNameCache = name);
          u.profilePicture$.pipe(takeUntil(this.destroy$)).subscribe(url => u.profilePictureCache = url);
        });
        this.followers$.next(mapped);
      });

    this.followService.getFollowing(this.profileUserId)
      .pipe(takeUntil(this.destroy$))
      .subscribe(async rawFollowing => {
        const mapped = await this.mapUsersToObservables(rawFollowing);
        mapped.forEach(u => {
          u.username$.pipe(takeUntil(this.destroy$)).subscribe(name => u.usernameCache = name);
          u.displayName$.pipe(takeUntil(this.destroy$)).subscribe(name => u.displayNameCache = name);
          u.profilePicture$.pipe(takeUntil(this.destroy$)).subscribe(url => u.profilePictureCache = url);
        });
        this.following$.next(mapped);
      });
  }

  private mapUsersToObservables(rawUsers: any[]): ObservableUser[] {
    return rawUsers.map(u => {
      const user$ = this.userService.getUserByUid(u.uid);

      const observableUser: ObservableUser = {
        uid: u.uid,
        username$: user$.pipe(map(user => user?.username || 'Unknown')),
        displayName$: user$.pipe(map(user => user?.displayName || 'Unknown')),
        profilePicture$: user$.pipe(map(user => user?.profilePicture || null)),
        userId$: user$.pipe(map(user => user?.userId || '')),

        following: this.followingSet.has(u.uid),

        // initial cache
        usernameCache: u.username,
        displayNameCache: u.displayName,
        profilePictureCache: u.profilePicture,
      };

      return observableUser;
    });
  }

  onSearch(value: string) {
    this.searchSubject.next(value);
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

  private updateFollowingState() {
    const followers = this.followers$.value;
    const following = this.following$.value;

    [...followers, ...following].forEach(user => {
      user.following = this.followingSet.has(user.uid);
    });

    // trigger UI update
    this.followers$.next([...followers]);
    this.following$.next([...following])
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
