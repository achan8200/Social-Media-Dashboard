import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { GroupsService } from '../../services/groups.service';
import { getInitial, getAvatarColor } from '../../utils/avatar';
import { trigger, transition, style, animate } from '@angular/animations';
import { BehaviorSubject, combineLatest, map, of, switchMap } from 'rxjs';

type Tab = 'my' | 'discover';

@Component({
  selector: 'app-groups',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './groups.html',
  styleUrl: './groups.css',
  animations: [
    // Overlay fade
    trigger('overlayFade', [
      transition(':enter', [style({ opacity: 0 }), animate('200ms ease-out', style({ opacity: 1 }))]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0 }))])
    ]),
    // Modal sliding/fade
    trigger('modalTransition', [
      transition('newChat <=> createGroup', [
        style({ opacity: 0, transform: 'translateX(50px)' }),
        animate('250ms ease-out', style({ opacity: 1, transform: 'translateX(0)' }))
      ]),
      transition('void => *', [style({ opacity: 0 }), animate('200ms ease-out', style({ opacity: 1 }))]),
      transition('* => void', [animate('150ms ease-in', style({ opacity: 0 }))])
    ])
  ]
})
export class Groups {
  private authService = inject(AuthService);
  private groupsService = inject(GroupsService);
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

  showCreateModal = false;

  // ─────────────────────────────
  // DATA STREAMS
  // ─────────────────────────────

  userGroups$ = this.authService.user$.pipe(
    switchMap(user => {
      if (!user) return of([]);
      return this.groupsService.getUserGroupsWithDetails(user.uid);
    })
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
    try {
      await this.groupsService.createGroup(name, bio);
      this.showCreateModal = false;
    } catch (err) {
      console.error(err);
    }
  }

  goToGroup(groupId: string) {
    this.router.navigate(['/group', groupId]);
  }

  // Shared avatar helpers
  getInitial = getInitial;
  getAvatarColor = getAvatarColor;
}