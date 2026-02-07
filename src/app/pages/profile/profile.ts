import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Firestore, collection, query, where, getDocs, doc, serverTimestamp, setDoc, getDoc } from '@angular/fire/firestore';
import { ActivatedRoute } from '@angular/router';
import { Observable, map, from, filter, combineLatest, switchMap, of, debounceTime, distinctUntilChanged, take } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './profile.html',
  styleUrl: './profile.css'
})
export class Profile {
  private firestore = inject(Firestore);
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);
  private route = inject(ActivatedRoute);

  profile$!: Observable<any>;
  isOwner$!: Observable<boolean>;

  editMode = false;
  originalProfile: any = null;
  hasChanges$!: Observable<boolean>;

  usernameAvailable: boolean | null = null;

  profileForm = this.fb.group({
    displayName: ['', Validators.required],
    username: ['', Validators.required],
    bio: [''],
    profilePicture: ['']
  });

   // Crop state
  cropImageSrc: string | null = null;
  cropX = 0;
  cropY = 0;
  cropScale = 1;

  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Touch pinch state
  private isPinching = false;
  private initialPinchDistance = 0;
  private initialScale = 1;

  constructor() {
    this.loadProfileFromRoute();
    this.profileForm.get('username')!
    .valueChanges
    .pipe(
      debounceTime(400),
      distinctUntilChanged()
    )
    .subscribe(async username => {
      if (!this.editMode) return;
      if (!username || username === this.originalProfile?.username) {
        this.usernameAvailable = null;
        return;
      }

      const isUnique = await this.authService.isUsernameUnique(username);
      this.usernameAvailable = isUnique;
    });

    this.profile$
    .pipe(takeUntilDestroyed())
    .subscribe(profile => {
      if (!profile) return;

      this.originalProfile = profile;

      // Keep form in sync when NOT editing
      if (!this.editMode) {
        this.profileForm.patchValue({
          displayName: profile.displayName ?? '',
          username: profile.username ?? '',
          bio: profile.bio ?? ''
        }, { emitEvent: false });
      }
    });

    this.hasChanges$ = this.profileForm.valueChanges.pipe(
      map(values => {
        if (!this.originalProfile) return false;

        return (
          values.displayName !== this.originalProfile.displayName ||
          values.username !== this.originalProfile.username ||
          values.bio !== this.originalProfile.bio
        );
      })
    );

    this.isOwner$ = combineLatest([
      this.authService.user$,
      this.profile$
    ]).pipe(
      map(([authUser, profile]) => {
        if (!authUser || !profile) return false;
        return authUser.uid === profile.uid;
      })
    );

    // Optional but VERY useful while debugging
    this.isOwner$.subscribe(isOwner => {
      console.log('[PROFILE] isOwner =', isOwner);
    });
  }

  /** Load profile based on /profile/:userId */
  private loadProfileFromRoute() {
    this.profile$ = this.route.params.pipe(
      map(params => params['userId'] as string),
      switchMap(uid => {
        if (!uid) return of(null);

        const ref = doc(this.firestore, `users/${uid}`);
        return from(getDoc(ref)).pipe(
          map(snap =>
            snap.exists()
              ? { uid: snap.id, ...snap.data() }
              : null
          )
        );
      })
    );
  }

  // Profile picture selection
  onProfilePictureSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || !input.files[0]) return;

    const file = input.files[0];
    if (!file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = () => {
      this.cropImageSrc = reader.result as string;
      this.cropX = 0;
      this.cropY = 0;
      this.cropScale = 1;
      input.value = '';
      this.cdr.detectChanges();
    };
    reader.readAsDataURL(file);
  }

  // Drag and zoom handlers
  startDrag(event: MouseEvent | TouchEvent) {
    if (event instanceof TouchEvent && event.touches.length === 2) {
      // Pinch start
      this.isPinching = true;
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      this.initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
      this.initialScale = this.cropScale;
      return;
    }

    this.isDragging = true;
    if (event instanceof MouseEvent) {
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    } else {
      this.lastMouseX = event.touches[0].clientX;
      this.lastMouseY = event.touches[0].clientY;
    }
  }


  drag(event: MouseEvent | TouchEvent) {
    if (this.isPinching && event instanceof TouchEvent && event.touches.length === 2) {
      // Pinch-to-zoom
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const scaleChange = distance / this.initialPinchDistance;
      this.cropScale = Math.max(0.5, Math.min(3, this.initialScale * scaleChange));
      return;
    }

    if (!this.isDragging) return;

    let clientX = 0;
    let clientY = 0;
    if (event instanceof MouseEvent) {
      clientX = event.clientX;
      clientY = event.clientY;
    } else {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    }

    this.cropX += clientX - this.lastMouseX;
    this.cropY += clientY - this.lastMouseY;

    this.lastMouseX = clientX;
    this.lastMouseY = clientY;
  }

  endDrag() {
    this.isDragging = false;
    this.isPinching = false;
  }

  zoom(delta: number) {
    this.cropScale = Math.max(0.5, Math.min(3, this.cropScale + delta));
  }

  // Save cropped image
  async saveCroppedProfilePicture() {
    const currentUser = await this.authService.getCurrentUser().toPromise();
    if (!currentUser || !this.cropImageSrc) return;

    const croppedBase64 = await this.cropAndResize(
      this.cropImageSrc,
      256,
      this.cropX,
      this.cropY,
      this.cropScale
    );

    // Save to Firestore
    const userRef = doc(this.firestore, `users/${currentUser.uid}`);
    await setDoc(userRef, { profilePicture: croppedBase64 }, { merge: true });

    // Update form and close modal
    this.profileForm.patchValue({ profilePicture: croppedBase64 });
    this.cropImageSrc = null;
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

        const dx = offsetX + img.width / 2 - size / 2;
        const dy = offsetY + img.height / 2 - size / 2;

        ctx.drawImage(img, -dx, -dy, img.width * scale, img.height * scale);

        resolve(canvas.toDataURL('image/jpeg'));
      };
    });
  }

  async removeProfilePicture() {
    const currentUser = await this.authService.getCurrentUser().toPromise();
    if (!currentUser) return;

    // Clear Firestore profilePicture field
    const userRef = doc(this.firestore, `users/${currentUser.uid}`);
    await setDoc(userRef, { profilePicture: '' }, { merge: true });

    // Update the local form and reset crop modal
    this.profileForm.patchValue({ profilePicture: '' });
    this.cropImageSrc = null;

    console.log('Profile picture removed');
  }

  // Avatar helpers
  getInitial(username?: string | null): string {
    if (!username) return '?';
    return username.charAt(0).toUpperCase();
  }

  getAvatarColor(username?: string | null): string {
    if (!username) return '#9CA3AF'; // gray-400 fallback

    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }

    const colors = [
      '#EF4444', // red
      '#F97316', // orange
      '#EAB308', // yellow
      '#22C55E', // green
      '#06B6D4', // cyan
      '#3B82F6', // blue
      '#6366F1', // indigo
      '#A855F7', // purple
      '#EC4899'  // pink
    ];

    return colors[Math.abs(hash) % colors.length];
  }

  enterEditMode() {
    this.editMode = true;
    
    this.profileForm.patchValue({
      displayName: this.originalProfile.displayName,
      username: this.originalProfile.username,
      bio: this.originalProfile.bio
    }, { emitEvent: false });
  }

  cancelEditProfile() {
    this.editMode = false;
    this.usernameAvailable = null;

    this.profileForm.patchValue({
      displayName: this.originalProfile.displayName,
      username: this.originalProfile.username,
      bio: this.originalProfile.bio
    }, { emitEvent: false });
  }

  hasChanges(): boolean {
    if (!this.originalProfile) return false;

    const v = this.profileForm.value;
    return (
      v.displayName !== this.originalProfile.displayName ||
      v.username !== this.originalProfile.username ||
      v.bio !== this.originalProfile.bio
    );
  }

  async saveEditProfile() {
    const currentUser = await this.authService.getCurrentUser().toPromise();
    if (!currentUser) return;

    if (!this.hasChanges()) return;

    if (this.usernameAvailable === false) {
      alert('Username is already taken');
      return;
    }

    const updatedData: any = {
      updatedAt: serverTimestamp()
    };

    const v = this.profileForm.value;

    if (v.displayName?.trim() !== this.originalProfile.displayName) {
      updatedData.displayName = v.displayName!.trim();
    }

    if (v.username !== this.originalProfile.username) {
      updatedData.username = v.username!.toLowerCase();
    }

    if (v.bio !== this.originalProfile.bio) {
      updatedData.bio = v.bio;
    }

    const userRef = doc(this.firestore, `users/${currentUser.uid}`);
    await setDoc(userRef, updatedData, { merge: true });

    this.editMode = false;
  }
}
