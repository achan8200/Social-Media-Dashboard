import { Component, ElementRef, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { GroupsService, Group, GroupMember } from '../../services/groups.service';
import { UserService } from '../../services/user.service';
import { Avatar } from "../../components/avatar/avatar";
import { trigger, transition, style, animate } from '@angular/animations';
import { combineLatest, map, Observable, of, shareReplay, switchMap, take } from 'rxjs';

type MemberVM = GroupMember & {
  user: any;
};

@Component({
  selector: 'app-group-page',
  standalone: true,
  imports: [CommonModule, FormsModule, Avatar],
  templateUrl: './group-page.html',
  styleUrl: './group-page.css',
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
export class GroupPage {
  private route = inject(ActivatedRoute);
  private authService = inject(AuthService);
  private groupsService = inject(GroupsService);
  private userService = inject(UserService);
  private el = inject(ElementRef);

  currentUser$!: Observable<any>;

  group$!: Observable<Group | null>;
  isMember$!: Observable<boolean>;
  currentUserRole$!: Observable<'owner' | 'moderator' | 'member' | null>;
  members$!: Observable<GroupMember[]>;
  memberCount$!: Observable<number>;

  groupId!: string;

  vm$!: Observable<{
    group: Group | null;
    isMember: boolean;
    user: any;
    members: MemberVM[];
    memberCount: number;
  }>;

  membersVM$!: Observable<MemberVM[]>;
  private userCache = new Map<string, Observable<any>>();

  showMembersModal = false;
  openMenuUid: string | null = null;
  openMenuDirection: { [uid: string]: 'up' | 'down' } = {};
  activeMenuEl: HTMLElement | null = null;

  confirmAction:
  | { type: 'remove' | 'promote' | 'demote' | 'transfer'; member: MemberVM }
  | null = null;

  confirmInput = '';

  ngOnInit() {
    this.currentUser$ = this.authService.user$.pipe(
      switchMap(user => {
        if (!user) return of(null);
        return this.userService.getUserByUid(user.uid);
      }),
      shareReplay(1)
    );

    const groupId$ = this.route.paramMap.pipe(
      map(params => params.get('groupId')!)
    );

    this.group$ = groupId$.pipe(
      switchMap(groupId => this.groupsService.getGroup(groupId))
    );

    this.members$ = groupId$.pipe(
      switchMap(groupId => this.groupsService.getMembers(groupId))
    );

    this.memberCount$ = this.members$.pipe(
      map(members => members.length)
    );

    this.membersVM$ = this.members$.pipe(
      switchMap(members => {
        if (!members.length) return of([]);

        const uids = [...new Set(members.map(m => m.uid))];

        return this.userService.getUsersByUids(uids).pipe(
          map(users => {
            const userMap = new Map(users.map(u => [u.uid, u]));

            return members.map(m => ({
              ...m,
              user: userMap.get(m.uid) || null
            }));
          })
        );
      })
    );

    this.isMember$ = combineLatest([
      groupId$,
      this.authService.user$
    ]).pipe(
      switchMap(([groupId, user]) => {
        if (!user) return of(false);
        return this.groupsService.isMember(groupId, user.uid);
      })
    );

    this.currentUserRole$ = combineLatest([
      this.members$,
      this.authService.user$
    ]).pipe(
      map(([members, user]) => {
        if (!user) return null;
        return members.find(m => m.uid === user.uid)?.role ?? null;
      }),
      shareReplay(1)
    );

    this.vm$ = combineLatest([
      this.group$,
      this.membersVM$,
      this.memberCount$,
      this.isMember$,
      this.currentUser$
    ]).pipe(
      map(([group, members, memberCount, isMember, user]) => ({
        group,
        members,
        memberCount,
        isMember,
        user
      }))
    );

    // Optional: keep raw groupId for actions
    groupId$.subscribe(id => this.groupId = id);
  }

  toggleMembership(isMember: boolean) {
    combineLatest([
      this.route.paramMap.pipe(map(p => p.get('groupId')!)),
      this.authService.user$
    ]).pipe(take(1))
    .subscribe(async ([groupId, user]) => {
      if (!user) return;

      if (isMember) {
        await this.groupsService.leaveGroup(groupId);
      } else {
        await this.groupsService.joinGroup(groupId);
      }
    });
  }

  canManageMember(currentRole: string | null, target: GroupMember, currentUid: string): boolean {
    if (!currentRole) return false;

    // Cannot act on yourself
    if (target.uid === currentUid) return false;

    if (currentRole === 'owner') {
      return true; // owner can manage everyone except self
    }

    if (currentRole === 'moderator') {
      return target.role === 'member'; // moderators can't touch mods/owner
    }

    return false;
  }

  toggleMenu(uid: string, event: Event) {
    event.stopPropagation();

    const buttonEl = event.currentTarget as HTMLElement;

    // Determine direction before opening
    const shouldOpenUp = this.isNearBottomOfModal(buttonEl);

    this.openMenuDirection[uid] = shouldOpenUp ? 'up' : 'down';

    this.openMenuUid = this.openMenuUid === uid ? null : uid;

    setTimeout(() => {
      this.activeMenuEl = document.querySelector('.dropdown-open') as HTMLElement;
    });
  }

  isNearBottomOfModal(element: HTMLElement): boolean {
    const modal = element.closest('.overflow-y-auto'); // scroll container
    if (!modal) return false;

    const rect = element.getBoundingClientRect();
    const modalRect = modal.getBoundingClientRect();

    const spaceBelow = modalRect.bottom - rect.bottom;

    return spaceBelow < 120; // threshold (adjust if needed)
  }

  openConfirm(type: any, member: MemberVM) {
    this.confirmAction = { type, member };
    this.confirmInput = '';
    this.openMenuUid = null;
  }

  closeConfirm() {
    this.confirmAction = null;
  }

  @HostListener('document:click', ['$event'])
  handleClickOutside(event: MouseEvent) {
    if (!this.openMenuUid) return;

    const target = event.target as HTMLElement;

    // If clicking inside the active dropdown → ignore
    if (this.activeMenuEl?.contains(target)) return;

    this.openMenuUid = null;
  }

  isConfirmValid(vmUser: any): boolean {
    if (!this.confirmAction) return false;

    const targetName =
      this.confirmAction.member.user?.username ||
      this.confirmAction.member.user?.displayName;

    switch (this.confirmAction.type) {
      case 'remove':
      case 'promote':
      case 'demote':
        return this.confirmInput === targetName;

      case 'transfer':
        return this.confirmInput === `${vmUser.username}/${targetName}`;

      default:
        return true;
    }
  }

  getConfirmPlaceholder(vm: any): string {
    if (!this.confirmAction) return '';

    const targetName =
      this.confirmAction.member.user?.username ||
      this.confirmAction.member.user?.displayName;

    const currentUsername = vm?.user?.username;

    if (this.confirmAction.type === 'transfer') {
      if (!currentUsername || !targetName) return 'Loading...';
      return `${currentUsername}/${targetName}`;
    }

    return targetName || '';
  }

  async executeAction(vm: any) {
    if (!this.confirmAction) return;

    const { type, member } = this.confirmAction;
    const groupId = this.groupId;

    this.confirmAction = null;
    this.confirmInput = '';

    if (type === 'remove') {
      await this.groupsService.removeMember(groupId, member.uid);
    }

    if (type === 'promote') {
      await this.groupsService.updateRole(groupId, member.uid, 'moderator');
    }

    if (type === 'demote') {
      await this.groupsService.updateRole(groupId, member.uid, 'member');
    }

    if (type === 'transfer') {
      await this.groupsService.transferOwnership(groupId, vm.user.uid, member.uid);
    }
  }

  private getUser(uid: string) {
    if (!this.userCache.has(uid)) {
      this.userCache.set(
        uid,
        this.userService.getUserByUid(uid).pipe(
          shareReplay(1)
        )
      );
    }
    return this.userCache.get(uid)!;
  }
}