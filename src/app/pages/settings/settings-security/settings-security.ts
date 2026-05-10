import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-settings-security',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings-security.html',
  styleUrl: './settings-security.css',
})
export class SettingsSecurity {

  // Email
  newEmail = '';
  emailPassword = '';
  emailError: string | null = null;

  // Password
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';

  updateEmailError = '';
  updateEmailSuccess = '';
  updatePasswordError = '';
  updatePasswordSuccess = '';

  loadingEmail = false;
  loadingPassword = false;

  passwordError: string | null = null;
  confirmPasswordError: string | null = null;

  passwordStrength = {
    length: false,
    uppercase: false,
    lowercase: false,
    number: false,
    special: false
  };

  constructor(
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  get isEmailFormValid(): boolean {
    return (
      !!this.newEmail &&
      !!this.emailPassword &&
      this.emailError === null
    );
  }

  get isPasswordFormValid(): boolean {
    return (
      !!this.currentPassword &&
      !!this.newPassword &&
      !!this.confirmPassword &&
      this.passwordError === null &&
      this.confirmPasswordError === null
    );
  }

  validateEmail() {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!this.newEmail) {
      this.emailError = null;
      return;
    }

    if (!emailRegex.test(this.newEmail.trim())) {
      this.emailError = 'Invalid email address';
      return;
    }

    this.emailError = null;
  }

  validatePassword() {
    const password = this.newPassword;

    this.passwordStrength = {
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[^A-Za-z0-9]/.test(password)
    };

    const allValid = Object.values(this.passwordStrength).every(Boolean);

    if (!password) {
      this.passwordError = null;
      return;
    }

    if (!allValid) {
      this.passwordError = 'Password does not meet all requirements';
      return;
    }

    this.passwordError = null;

    this.validateConfirmPassword();
  }

  validateConfirmPassword() {
    if (!this.confirmPassword) {
      this.confirmPasswordError = null;
      return;
    }

    this.confirmPasswordError =
      this.newPassword === this.confirmPassword
        ? null
        : 'Passwords do not match';
  }

  async updateEmail() {
    this.updateEmailError = '';
    this.updateEmailSuccess = '';

    this.validateEmail();

    if (this.emailError) {
      return;
    }

    try {
      this.loadingEmail = true;

      await this.authService.updateUserEmail(
        this.newEmail.trim(),
        this.emailPassword
      );

      this.updateEmailSuccess = 'If the email can be used, a verification email has been sent.';

      this.newEmail = '';
      this.emailPassword = '';

    } catch (err: any) {
      this.updateEmailSuccess = '';
      
      if (err.code === 'auth/email-already-in-use') {
        this.updateEmailError = 'Email already in use';
      } else if (err.code === 'auth/invalid-credential') {
        this.updateEmailError = 'Current password is incorrect';
      } else {
        this.updateEmailError = err.message || 'Failed to update email';
      }

      this.cdr.detectChanges();
    } finally {
      this.loadingEmail = false;
      this.cdr.detectChanges();
    }
  }

  async updatePassword() {
    this.updatePasswordError = '';
    this.updatePasswordSuccess = '';

    this.validatePassword();
    this.validateConfirmPassword();

    if (!this.isPasswordFormValid) {
      return;
    }

    try {
      this.loadingPassword = true;

      await this.authService.updateUserPassword(
        this.newPassword,
        this.currentPassword
      );

      this.updatePasswordSuccess = 'Password updated successfully';

      this.currentPassword = '';
      this.newPassword = '';
      this.confirmPassword = '';

      this.passwordStrength = {
        length: false,
        uppercase: false,
        lowercase: false,
        number: false,
        special: false
      };

      this.passwordError = null;
      this.confirmPasswordError = null;

    } catch (err: any) {
      if (err.code === 'auth/invalid-credential') {
        this.updatePasswordError = 'Current password is incorrect';
      }
      this.cdr.detectChanges();
    } finally {
      this.loadingPassword = false;
      this.cdr.detectChanges();
    }
  }
}