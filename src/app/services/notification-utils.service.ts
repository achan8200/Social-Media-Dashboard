import { Injectable } from '@angular/core';
import { Notification } from '../models/notification.model';

type DayKey = 'Today' | 'Yesterday' | 'Earlier';

@Injectable({ providedIn: 'root' })
export class NotificationUtilsService {

	// Groups notifications first by day, then by type/post/comment/follow
  groupNotificationsByDay(list: Notification[]): Record<string, Notification[][]> {
    const days: Record<string, Notification[][]> = {};

    list.forEach(n => {
      const date = n.createdAt?.toDate?.();
      const dayKey = this.getNotificationSection(date) || 'Earlier';

      if (!days[dayKey]) {
        days[dayKey] = [];
      }

      // Build grouping key
      let key = n.type;

      switch (n.type) {
        case 'like_post':
        case 'comment_post':
        case 'like_comment':
          key += `_${n.postId || ''}_${n.commentId || ''}`;
          break;
        case 'follow':
          key = 'follow';
          break;
        case 'thread_added':
          key = 'thread_added';
          break;
        case 'promote':
          key = 'promote';
          break;
      }

      // Find existing group
      let group = days[dayKey].find(g => {
        const gKey = g[0]?.type + '_' + (g[0]?.postId || '') + '_' + (g[0]?.commentId || '');
        return gKey === key;
      });

      // Create new group if not found
      if (!group) {
        group = [];
        days[dayKey].push(group);
      }

      group.push(n);
    });

    // Sorting
    Object.keys(days).forEach(day => {
      // Sort notifications inside each group (newest first)
      days[day].forEach(group => {
        group.sort((a, b) => {
          const timeA = a.createdAt?.toDate?.()?.getTime() ?? 0;
          const timeB = b.createdAt?.toDate?.()?.getTime() ?? 0;
          return timeB - timeA;
        });
      });

      // Sort groups by most recent notification in each group
      days[day].sort((a, b) => {
        const timeA = a[0]?.createdAt?.toDate?.()?.getTime() ?? 0;
        const timeB = b[0]?.createdAt?.toDate?.()?.getTime() ?? 0;
        return timeB - timeA;
      });
    });

    return days;
  }

  // Determine section label
  getNotificationSection(date?: Date): DayKey {
    if (!date) return 'Earlier';

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const d = new Date(date);

    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return 'Earlier';
  }

	formatNotificationTimestamp(date?: Date): string {
		if (!date) return '';

		const section = this.getNotificationSection(date);

		// Today / Yesterday -> show time
		if (section === 'Today' || section === 'Yesterday') {
			return date.toLocaleTimeString([], {
				hour: 'numeric',
				minute: '2-digit'
			});
		}

		const now = new Date();
		const isSameYear = date.getFullYear() === now.getFullYear();

		// Earlier -> show month/day (+ year if not current year)
		return date.toLocaleDateString([], {
			month: 'short',
			day: 'numeric',
			...(isSameYear ? {} : { year: 'numeric' })
		}).replace(',', '');
	}
}