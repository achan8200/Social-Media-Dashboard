import { Component, ChangeDetectorRef  } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrls: ['./login.css']
})
export class Login {
  email = '';
  password = '';
  error = '';

  showPassword = false;

  constructor(
    private authService: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  async login() {
    this.error = '';

    try {
      await this.authService.login(this.email, this.password);
      this.router.navigate(['/home'], { replaceUrl: true });
    } catch (err: any) {
      let message = 'Login failed. Please try again.';

      if (err.code === 'auth/user-not-found') {
        message = 'No account found with this email.';
      } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        // Sometimes Firebase throws "invalid-credential" instead of "wrong-password"
        message = 'Incorrect password.';
      } else if (err.code === 'auth/invalid-email') {
        message = 'Invalid email address.';
      } else if (err.code === 'auth/user-disabled') {
        message = 'This account has been disabled.';
      } else if (err.message) {
        message = err.message;
      }

      this.error = message;

      this.cdr.detectChanges();
    }
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }
}