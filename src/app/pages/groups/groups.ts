import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { collection, Firestore, getDocs, query, where } from '@angular/fire/firestore';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { GroupsService } from '../../services/groups.service';
import { UserService } from '../../services/user.service';
import { getInitial, getAvatarColor } from '../../utils/avatar';
import { trigger, transition, style, animate } from '@angular/animations';
import { BehaviorSubject, combineLatest, firstValueFrom, map, Observable, of, switchMap } from 'rxjs';

type Tab = 'my' | 'discover';

@Component({
  selector: 'app-groups',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './groups.html',
  styleUrl: './groups.css',
  animations: [
    trigger('overlayFade', [
      transition(':enter', [style({ opacity: 0 }), animate('200ms ease-out', style({ opacity: 1 }))]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0 }))])
    ]),
    trigger('modalScale', [
      transition(':enter', [style({ opacity: 0, transform: 'scale(0.95)' }), animate('200ms ease-out', style({ opacity: 1, transform: 'scale(1)' }))]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0, transform: 'scale(0.95)' }))])
    ])
  ]
})
export class Groups {
  private route = inject(ActivatedRoute);
  private firestore = inject(Firestore);
  private authService = inject(AuthService);
  private groupsService = inject(GroupsService);
  private userService = inject(UserService);
  private router = inject(Router);

  // ─────────────────────────────
  // STATE (BehaviorSubjects = reactive store)
  // ─────────────────────────────
  private tabSubject = new BehaviorSubject<Tab>('my');
  private searchSubject = new BehaviorSubject<string>('');

  tab$ = this.tabSubject.asObservable();
  search$ = this.searchSubject.asObservable();

  role?: 'owner' | 'moderator' | 'member';
  isMember?: boolean;

  groupName = '';
  showCreateModal = false;
  isCreating = false;

  profileUserId: string | null = null;
  currentUserId: string | null = null;
  isOwnProfile = false;
  profileUsername$: Observable<string> | null = null;

  // ─────────────────────────────
  // DATA STREAMS
  // ─────────────────────────────

  userGroups$ = this.route.paramMap.pipe(
    switchMap(async params => {
      const username = params.get('username');

      if (username) {
        // Fetch target user
        const usersRef = collection(this.firestore, 'users');
        const q = query(usersRef, where('username', '==', username));
        const snap = await getDocs(q);

        if (snap.empty) return [];

        const targetUid = snap.docs[0].id;
        return firstValueFrom(
          this.groupsService.getUserGroupsWithDetails(targetUid)
        );
      } else {
        const user = await firstValueFrom(this.authService.user$);
        if (!user) return [];
        return firstValueFrom(
          this.groupsService.getUserGroupsWithDetails(user.uid)
        );
      }
    }),
    switchMap(groups => of(groups))
  );

  discoverGroups$ = this.groupsService.getAllGroups();

  // ─────────────────────────────
  // FINAL DERIVED STREAM (single source of truth)
  // ─────────────────────────────
  groups$ = combineLatest([
    this.tab$,
    this.search$,
    this.userGroups$,
    this.discoverGroups$
  ]).pipe(
    map(([tab, search, myGroups, allGroups]) => {

      let base: any[];

      if (tab === 'my') {
        base = myGroups;
      } else {
        // merge role info into discover
        const roleMap = new Map(myGroups.map(g => [g.id, g]));

        base = allGroups.map(g => ({
          ...g,
          ...(roleMap.get(g.id!) || {})
        }));
      }

      const term = search.toLowerCase().trim();

      if (!term) return base;

      return base.filter(group =>
        group.name.toLowerCase().includes(term)
      );
    })
  );

  async ngOnInit() {
    const user = await firstValueFrom(this.authService.user$);
    this.currentUserId = user?.uid || null;

    await this.loadProfile();

    this.isOwnProfile = this.profileUserId === this.currentUserId;
  }

  private async loadProfile() {
    const username = this.route.snapshot.paramMap.get('username');

    if (username) {
      // Viewing someone else's groups
      const usersRef = collection(this.firestore, 'users');
      const q = query(usersRef, where('username', '==', username));
      const snap = await getDocs(q);

      if (!snap.empty) {
        this.profileUserId = snap.docs[0].id;
      }
    } else {
      // Own groups
      this.profileUserId = this.currentUserId;
    }

    if (this.profileUserId && !this.isOwnProfile) {
      this.profileUsername$ = this.userService.getUserByUid(this.profileUserId).pipe(
        map(user => user?.username ?? 'Unknown')
      );
    }
  }

  // ─────────────────────────────
  // ACTIONS (clean state updates)
  // ─────────────────────────────

  setTab(tab: Tab) {
    this.tabSubject.next(tab);
  }

  onSearch(value: string) {
    this.searchSubject.next(value);
  }

  async createGroup(name: string, bio: string) {
    if (this.isCreating) return;

    this.isCreating = true;

    try {
      await this.groupsService.createGroup(name, bio);
      this.showCreateModal = false;
    } catch (err) {
      console.error(err);
    } finally {
      this.isCreating = false;
    }
  }

  goToGroup(groupId: string) {
    this.router.navigate(['/group', groupId]);
  }

  // Shared avatar helpers
  getInitial = getInitial;
  getAvatarColor = getAvatarColor;
}