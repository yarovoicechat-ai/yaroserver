const DISALLOWED_EXTENSIONS = new Set([
  '.exe', '.sh', '.bat', '.cmd', '.js', '.ts', '.php', '.py', '.bin',
  '.jar', '.apk', '.vbs', '.msi', '.scr', '.com', '.pif', '.cgi', '.pl',
  '.html', '.htm', '.svg'
]);

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export interface AvatarValidationResult {
  valid: boolean;
  error?: string;
  cleanAvatar?: string;
}

/**
 * Validates avatar string input for security, allowed extensions, and supported formats.
 * Enforces:
 * - Allowed formats: JPG, JPEG, PNG, WEBP (and trusted Cloudinary assets)
 * - Strict prohibition of executable or script payloads
 * - Max URL length
 */
export function validateAvatarSecurity(input: unknown): AvatarValidationResult {
  if (!input || typeof input !== 'string') {
    return { valid: false, error: 'Avatar image URL or path is required' };
  }

  const cleanAvatar = input.trim();
  if (cleanAvatar.length === 0) {
    return { valid: false, error: 'Avatar image cannot be empty' };
  }

  if (cleanAvatar.length > 2048 && !cleanAvatar.startsWith('data:image/')) {
    return { valid: false, error: 'Avatar image URL exceeds maximum length' };
  }

  const lower = cleanAvatar.toLowerCase();

  // Extract path without query parameters or hashes
  let pathname = lower;
  try {
    if (lower.startsWith('http://') || lower.startsWith('https://')) {
      const parsed = new URL(lower);
      pathname = parsed.pathname;
    } else {
      pathname = lower.split('?')[0].split('#')[0];
    }
  } catch {
    pathname = lower.split('?')[0].split('#')[0];
  }

  // Check path segments and filename for disallowed extensions
  const segments = pathname.split('/');
  const filename = segments[segments.length - 1] || '';
  const lastDot = filename.lastIndexOf('.');
  const fileExt = lastDot !== -1 ? filename.substring(lastDot) : '';

  // Check if filename ends with or contains any disallowed extension
  for (const ext of DISALLOWED_EXTENSIONS) {
    if (filename.endsWith(ext) || pathname.includes(`${ext}/`) || filename.includes(ext)) {
      return { valid: false, error: `Invalid avatar file format. Executables and script files are forbidden (${ext})` };
    }
  }

  // Handle data URI
  if (lower.startsWith('data:image/')) {
    const isAllowedDataUri =
      lower.startsWith('data:image/jpeg') ||
      lower.startsWith('data:image/jpg') ||
      lower.startsWith('data:image/png') ||
      lower.startsWith('data:image/webp');
    if (!isAllowedDataUri) {
      return { valid: false, error: 'Only JPG, JPEG, PNG and WEBP data URIs are allowed' };
    }
    return { valid: true, cleanAvatar };
  }

  // URL or path validation
  const isHttp = lower.startsWith('http://') || lower.startsWith('https://');
  const isLocalUpload = lower.startsWith('/uploads/') || lower.startsWith('uploads/');

  if (!isHttp && !isLocalUpload) {
    return { valid: false, error: 'Avatar must be a valid HTTP/HTTPS URL or server upload path' };
  }

  // For URLs, check if it contains allowed image extension or is from a recognized trusted CDN (e.g., Cloudinary)
  const isCloudinary = lower.includes('cloudinary.com') || lower.includes('res.cloudinary.com');
  const hasAllowedExt = ALLOWED_IMAGE_EXTENSIONS.has(fileExt) ||
    Array.from(ALLOWED_IMAGE_EXTENSIONS).some(ext => filename.endsWith(ext) || pathname.endsWith(ext));

  if (!hasAllowedExt && !isCloudinary) {
    return { valid: false, error: 'Avatar format not supported. Allowed formats: JPG, JPEG, PNG, WEBP' };
  }

  return { valid: true, cleanAvatar };
}
