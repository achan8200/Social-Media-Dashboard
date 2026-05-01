import { ChangeDetectorRef, Component, ElementRef, HostListener, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { GroupsService, Group, GroupMember } from '../../services/groups.service';
import { PostsService } from '../../services/posts.service';
import { Post } from '../../models/post.model';
import { PostModal } from "../../components/post-modal/post-modal";
import { CreatePostModal } from "../../components/create-post-modal/create-post-modal";
import { MessagesService } from '../../services/messages.service';
import { UserService } from '../../services/user.service';
import { Avatar } from "../../components/avatar/avatar";
import { GroupChatWindow } from './group-chat-window/group-chat-window';
import { getInitial, getAvatarColor } from '../../utils/avatar';
import { trigger, transition, style, animate } from '@angular/animations';
import { combineLatest, map, Observable, of, shareReplay, switchMap, take } from 'rxjs';

type MemberVM = GroupMember & {
  user: any;
};

@Component({
  selector: 'app-group-page',
  standalone: true,
  imports: [CommonModule, FormsModule, Avatar, PostModal, CreatePostModal, GroupChatWindow],
  templateUrl: './group-page.html',
  styleUrl: './group-page.css',
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
export class GroupPage {
  private route = inject(ActivatedRoute);
  private authService = inject(AuthService);
  private groupsService = inject(GroupsService);
  private messagesService = inject(MessagesService);
  private postsService = inject(PostsService);
  private userService = inject(UserService);
  private cdr = inject(ChangeDetectorRef);

  currentUser$!: Observable<any>;

  group$!: Observable<Group | null>;
  isMember$!: Observable<boolean>;
  isGuest$!: Observable<boolean>;
  currentUserRole$!: Observable<'owner' | 'moderator' | 'member' | null>;
  canEditGroup$!: Observable<boolean>;
  members$!: Observable<GroupMember[]>;
  memberCount$!: Observable<number>;
  groupUnreadCount$!: Observable<number>;

  groupId!: string;

  vm$!: Observable<{
    group: Group | null;
    isMember: boolean;
    user: any;
    members: MemberVM[];
    memberCount: number;
    postCount: number;
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

  showSettingsModal = false;
  groupForm = {
    name: '',
    bio: '',
    avatar: ''
  };

  showRemoveConfirm = false;

  originalGroupForm: any = null;

  activeTab: 'posts' | 'messages' = 'posts';

  showCreateModal = false;
  selectedPost: Post | null = null;
  groupPosts$!: Observable<Post[]>;
  postCount$!: Observable<number>;

  // Crop state
  cropImageSrc: string | null = null;
  crop = { x: 0, y: 0, scale: 1 };

  imageNaturalWidth = 0;
  imageNaturalHeight = 0;
  imageDisplayWidth = 0;
  imageDisplayHeight = 0;

  minScale = 1;

  // drag/pinch state
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  private isPinching = false;
  private initialPinchDistance = 0;
  private initialScale = 1;

  @ViewChild('cropCircle') cropCircle!: ElementRef<HTMLDivElement>;

  ngOnInit() {
    this.isGuest$ = this.authService.user$.pipe(
      map(user => !user)  // true if no user is logged in
    );
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

    this.isMember$.subscribe(isMember => {
      if (!isMember && this.activeTab === 'messages') {
        this.activeTab = 'posts';
      }
    });

    this.groupUnreadCount$ = groupId$.pipe(
      switchMap(groupId => 
        this.messagesService.getGroupThread(groupId)
      ),
      map(thread => thread?.unreadCount || 0)
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

    this.canEditGroup$ = this.currentUserRole$.pipe(
      map(role => role === 'owner' || role === 'moderator')
    );

    this.groupPosts$ = groupId$.pipe(
      switchMap(groupId => this.postsService.getPostsByGroup(groupId))
    );

    this.postCount$ = this.groupPosts$.pipe(
      map(posts => posts.length),
      shareReplay(1)
    );

    this.vm$ = combineLatest([
      this.group$,
      this.membersVM$,
      this.memberCount$,
      this.groupPosts$,
      this.isMember$,
      this.currentUser$
    ]).pipe(
      map(([group, members, memberCount, posts, isMember, user]) => ({
        group,
        members,
        memberCount,
        postCount: posts.length,
        isMember,
        user
      }))
    );

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

  openSettings() {
    this.showSettingsModal = true;

    this.group$.pipe(take(1)).subscribe(group => {
      if (!group) return;

      this.originalGroupForm = {
        name: group.name,
        bio: group.bio || '',
        avatar: group.avatar || ''
      };

      this.groupForm = { ...this.originalGroupForm };
    });
  }

  closeSettings() {
    this.groupForm = { ...this.originalGroupForm };
    this.showSettingsModal = false;
  }

  async saveGroupSettings() {
    if (!this.groupId) return;

    const trimmedName = this.groupForm.name?.trim();

    if (!trimmedName) {
      console.warn('Group name cannot be empty');
      return;
    }

    await this.groupsService.updateGroup(this.groupId, {
      name: trimmedName,
      bio: this.groupForm.bio,
      avatar: this.groupForm.avatar
    });

    this.showSettingsModal = false;
  }

  // Group picture selection
  onGroupAvatarSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];
    if (!file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.src = reader.result as string;

      img.onload = () => {
        this.cropImageSrc = img.src;

        this.imageNaturalWidth = img.width;
        this.imageNaturalHeight = img.height;

        // Normalize large images
        const maxDim = 512;
        const scale = Math.min(
          maxDim / img.width,
          maxDim / img.height,
          1
        );

        this.imageDisplayWidth = img.width * scale;
        this.imageDisplayHeight = img.height * scale;

        const circleSize = 256;

        this.minScale = Math.max(
          circleSize / this.imageDisplayWidth,
          circleSize / this.imageDisplayHeight
        );

        this.crop = {
          x: 0,
          y: 0,
          scale: this.minScale
        };

        input.value = '';
        this.cdr.detectChanges();
      };
    };
    reader.readAsDataURL(file);
  }

  // Drag and zoom handlers
  startDrag(event: MouseEvent | TouchEvent) {
    if (event instanceof TouchEvent && event.touches.length === 2) {
      this.isPinching = true;

      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;

      this.initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
      this.initialScale = this.crop.scale;
      return;
    }

    this.isDragging = true;

    const point = event instanceof MouseEvent
      ? event
      : event.touches[0];

    this.lastMouseX = point.clientX;
    this.lastMouseY = point.clientY;
  }


  drag(event: MouseEvent | TouchEvent) {
    if (this.isPinching && event instanceof TouchEvent && event.touches.length === 2) {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;

      const distance = Math.sqrt(dx * dx + dy * dy);
      const scaleChange = distance / this.initialPinchDistance;

      const newScale = this.initialScale * scaleChange;
      this.crop.scale = Math.max(this.minScale, Math.min(3, newScale));

      this.clampPosition();
      return;
    }

    if (!this.isDragging) return;

    const point = event instanceof MouseEvent
      ? event
      : event.touches[0];

    const dx = point.clientX - this.lastMouseX;
    const dy = point.clientY - this.lastMouseY;

    this.crop.x += dx / this.crop.scale;
    this.crop.y += dy / this.crop.scale;

    this.lastMouseX = point.clientX;
    this.lastMouseY = point.clientY;

    this.clampPosition();
  }

  endDrag() {
    this.isDragging = false;
    this.isPinching = false;
  }

  zoom(delta: number) {
    const newScale = this.crop.scale + delta;
    this.crop.scale = Math.max(this.minScale, Math.min(3, newScale));
    this.clampPosition();
  }

  clampPosition() {
    const circleSize = 256;

    const scaledWidth = this.imageDisplayWidth * this.crop.scale;
    const scaledHeight = this.imageDisplayHeight * this.crop.scale;

    const maxX = Math.max(0, (scaledWidth - circleSize) / 2);
    const maxY = Math.max(0, (scaledHeight - circleSize) / 2);

    this.crop.x = Math.max(-maxX, Math.min(maxX, this.crop.x));
    this.crop.y = Math.max(-maxY, Math.min(maxY, this.crop.y));
  }

  onSliderChange(event: Event) {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    this.crop.scale = Math.max(this.minScale, Math.min(3, value));
    this.clampPosition();
  }

  // Save cropped image
  async saveCroppedGroupAvatar() {
    if (!this.cropImageSrc) return;

    const avatarSize = 256;

    const croppedBase64 = await this.cropAndResize(
      this.cropImageSrc,
      avatarSize,
      this.crop.x,
      this.crop.y,
      this.crop.scale
    );

    this.groupForm.avatar = croppedBase64;
    this.cropImageSrc = null;
    this.cdr.detectChanges();
  }

  async cropAndResize(
    src: string,
    size: number,
    offsetX: number,
    offsetY: number,
    scale: number
  ): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = src;

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;

        const ctx = canvas.getContext('2d')!;

        // Move origin to center
        ctx.translate(size / 2, size / 2);

        // Apply offset
        ctx.translate(offsetX, offsetY);

        // Apply scale
        ctx.scale(scale, scale);

        // Draw image centered with offset
        ctx.drawImage(
          img,
          -this.imageDisplayWidth / 2,
          -this.imageDisplayHeight / 2,
          this.imageDisplayWidth,
          this.imageDisplayHeight
        );

        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
    });
  }

  cancelCrop() {
    this.cropImageSrc = null;
    this.crop = { x: 0, y: 0, scale: 1 };
    this.imageNaturalWidth = 0;
    this.imageNaturalHeight = 0;
    this.imageDisplayWidth = 0;
    this.imageDisplayHeight = 0;
  }

  async removeGroupPicture() {
    if (!this.groupId) return;

    try {
      await this.groupsService.updateGroup(this.groupId, {
        avatar: ''
      });

      this.groupForm.avatar = '';
      this.cropImageSrc = null;
    } finally {
      this.showRemoveConfirm = false;
    }
  }

  confirmRemoveProfilePicture() {
    this.cropImageSrc = null;
    this.showRemoveConfirm = true;
  }

  cancelRemoveGroupPicture() {
    this.showRemoveConfirm = false;
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

  // Shared avatar helpers
  getInitial = getInitial;
  getAvatarColor = getAvatarColor;

  openCreateModal() {
    this.showCreateModal = true;
  }

  closeCreateModal() {
    this.showCreateModal = false;
  }

  openPostModal(post: Post) {
    this.selectedPost = post;
  }

  closePostModal() {
    this.selectedPost = null;
  }

  setTab(tab: 'posts' | 'messages') {
    this.activeTab = tab;
  }

  async openMessagesTab() {
    this.activeTab = 'messages';

    if (!this.groupId) return;

    try {
      await this.messagesService.markGroupMessagesAsRead(this.groupId);
    } catch (err) {
      console.error('Failed to mark messages as read', err);
    }
  }

  trackByPostId(index: number, post: Post) {
    return post.id;
  }
}