import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './signup.html',
  styleUrls: ['./signup.css']
})
export class Signup {
  email = '';
  password = '';
  error = '';

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  async signup() {
    this.error = '';

    try {
      await this.authService.signup(this.email, this.password);
      this.router.navigate(['/home'], { replaceUrl: true });
    } catch (err: any) {
      this.error = err.message || 'Signup failed';
    }
  }
}