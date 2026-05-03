import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, inject, ViewChild } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Firestore, doc, setDoc, serverTimestamp, docData } from '@angular/fire/firestore';
import { AuthService } from '../../../services/auth.service';
import { getInitial, getAvatarColor } from '../../../utils/avatar';
import { trigger, style, transition, animate } from '@angular/animations';
import { Observable, switchMap, of, firstValueFrom, debounceTime, distinctUntilChanged, finalize, from, map, shareReplay, tap } from 'rxjs';

type UsernameStatus =
  | 'available'
  | 'invalid'
  | 'taken'
  | null;

@Component({
  selector: 'app-settings-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './settings-profile.html',
  styleUrl: './settings-profile.css',
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
export class SettingsProfile {

  private fb = inject(FormBuilder);
  private firestore = inject(Firestore);
  private authService = inject(AuthService);
  private cdr = inject(ChangeDetectorRef);

  profile$!: Observable<any>;

  usernameStatus$!: Observable<UsernameStatus>;
  currentUsernameStatus: UsernameStatus = null;
  checkingUsername = false;
  isSaving = false;

  profileForm = this.fb.group({
    displayName: ['', Validators.required],
    username: ['', Validators.required],
    bio: [''],
    profilePicture: ['']
  });

  originalProfile: any;

  // Crop state
  cropImageSrc: string | null = null;
  crop = {
    x: 0,
    y: 0,
    scale: 1
  };

  // Track image natural size
  imageNaturalWidth = 0;
  imageNaturalHeight = 0;

  // Display size (normalized)
  imageDisplayWidth = 0;
  imageDisplayHeight = 0;

  @ViewChild('cropCircle') cropCircle!: ElementRef<HTMLDivElement>;

  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Touch pinch state
  private isPinching = false;
  private initialPinchDistance = 0;
  private initialScale = 1;
  minScale = 1;

  showRemoveConfirm = false;

  ngOnInit() {
    this.profile$ = this.authService.user$.pipe(
      switchMap(user => {
        if (!user) return of(null);
        const ref = doc(this.firestore, `users/${user.uid}`);
        return docData(ref, { idField: 'uid' });
      })
    );

    this.usernameStatus$ = this.profileForm.get('username')!
      .valueChanges
      .pipe(
        map(value => value?.trim().toLowerCase() ?? ''),
        debounceTime(400),
        distinctUntilChanged(),
        tap(() => {
          this.checkingUsername = true;
          this.cdr.detectChanges();
        }),
        switchMap(trimmed => {
          if (!this.originalProfile) {
            this.checkingUsername = false;
            this.cdr.detectChanges();
            return of(null);
          }
    
          const original = this.originalProfile.username?.trim().toLowerCase();
    
          if (trimmed === original) {
            this.checkingUsername = false;
            this.cdr.detectChanges();
            return of(null);
          }
    
          const validationError = this.authService.validateUsername(trimmed);
          if (validationError) {
            this.checkingUsername = false;
            this.cdr.detectChanges();
            return of('invalid' as const);
          }
    
          return from(this.authService.isUsernameUnique(trimmed)).pipe(
            map(isUnique => isUnique ? ('available' as const) : ('taken' as const)),
            finalize(() => {
              this.checkingUsername = false;
              this.cdr.detectChanges();
            })
          );
        }),
        shareReplay(1)
      );

    this.usernameStatus$.subscribe(status => {
      this.currentUsernameStatus = status;
      this.cdr.detectChanges();
    });

    this.profile$.subscribe(profile => {
      if (!profile) return;

      this.originalProfile = profile;

      this.profileForm.patchValue({
        displayName: profile.displayName ?? '',
        username: profile.username ?? '',
        bio: profile.bio ?? '',
        profilePicture: profile.profilePicture ?? ''
      }, { emitEvent: false });
    });
  }

  // Profile picture selection
  onProfilePictureSelected(event: Event) {
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
  async saveCroppedProfilePicture() {
    const currentUser = await firstValueFrom(this.authService.user$);
    if (!currentUser || !this.cropImageSrc) return;

    const avatarSize = 256;

    const croppedBase64 = await this.cropAndResize(
      this.cropImageSrc,
      avatarSize,
      this.crop.x,
      this.crop.y,
      this.crop.scale
    );

    // Save to Firestore
    const userRef = doc(this.firestore, `users/${currentUser.uid}`);
    await setDoc(userRef, { profilePicture: croppedBase64, updatedAt: serverTimestamp() }, { merge: true });

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

  async removeProfilePicture() {
    const currentUser = await firstValueFrom(this.authService.user$);
    if (!currentUser) throw new Error('Not authenticated');

    // Clear Firestore profilePicture field
    const userRef = doc(this.firestore, `users/${currentUser.uid}`);
    await setDoc(userRef, { profilePicture: '', updatedAt: serverTimestamp() }, { merge: true });

    // Update the local form and reset crop modal
    this.profileForm.patchValue({ profilePicture: '' });
    this.cropImageSrc = null;
    this.showRemoveConfirm = false;
  }

  confirmRemoveProfilePicture() {
    this.cropImageSrc = null;
    this.showRemoveConfirm = true;
  }

  cancelRemoveProfilePicture() {
    this.showRemoveConfirm = false;
  }

  hasChanges(): boolean {
    const v = this.profileForm.value;
    return (
      v.displayName !== this.originalProfile.displayName ||
      v.username !== this.originalProfile.username ||
      v.bio !== this.originalProfile.bio
    );
  }

  get canSave(): boolean {
    if (!this.originalProfile) return false;

    const trimmed = this.profileForm.value.username?.trim().toLowerCase();
    const original = this.originalProfile.username?.trim().toLowerCase();

    const usernameChanged = trimmed !== original;

    return (
      this.hasChanges() &&
      this.profileForm.valid &&
      !this.isSaving &&
      !this.checkingUsername &&
      (
        // If username didn't change -> fine
        !usernameChanged ||

        // If changed -> must explicitly be available
        this.currentUsernameStatus === 'available'
      )
    );
  }

  async save() {
    if (!this.hasChanges()) return;

    const user = await firstValueFrom(this.authService.user$);
    if (!user) return;

    this.isSaving = true;

    const v = this.profileForm.value;

    const updatedData: any = {
      displayName: v.displayName?.trim(),
      username: v.username?.trim().toLowerCase(),
      bio: v.bio ?? '',
      updatedAt: serverTimestamp()
    };

    const ref = doc(this.firestore, `users/${user.uid}`);
    await setDoc(ref, updatedData, { merge: true });

    this.originalProfile = { ...this.originalProfile, ...updatedData };

    this.isSaving = false;
  }

  getInitial = getInitial;
  getAvatarColor = getAvatarColor;
}