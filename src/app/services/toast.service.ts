import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface ToastData {
  message: string;
  type?: 'success' | 'error' | 'info';
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {

  private toastSubject = new BehaviorSubject<ToastData | null>(null);

  toast$ = this.toastSubject.asObservable();

  show(
    message: string,
    type: 'success' | 'error' | 'info' = 'info'
  ) {
    this.toastSubject.next({ message, type });

    setTimeout(() => {
      this.clear();
    }, 3000);
  }

  clear() {
    this.toastSubject.next(null);
  }
}