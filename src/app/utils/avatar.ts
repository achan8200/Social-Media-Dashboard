export function getInitial(username?: string | null): string {
  if (!username) return '?';
  return username.charAt(0).toUpperCase();
}

export function getAvatarColor(username?: string | null): string {
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