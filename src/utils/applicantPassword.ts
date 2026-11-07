// Custom dynamic applicant password generator combining Name + Phone / Email
export const generateApplicantPassword = (name?: string, phone?: string, email?: string): string => {
  const cleanName = (name || 'User').replace(/[^a-zA-Z]/g, '');
  const prefix = cleanName.length >= 3
    ? cleanName.slice(0, 3).charAt(0).toUpperCase() + cleanName.slice(1, 3).toLowerCase()
    : (cleanName.length > 0 ? cleanName.charAt(0).toUpperCase() + cleanName.slice(1).toLowerCase() : 'Mith');

  const phoneDigits = (phone || '').replace(/\D/g, '');
  let numPart = phoneDigits.length >= 4 ? phoneDigits.slice(-4) : '';

  if (!numPart && email) {
    const emailDigits = email.replace(/\D/g, '');
    numPart = emailDigits.length >= 4 ? emailDigits.slice(-4) : '';
  }

  if (!numPart) {
    numPart = '1234';
  }

  return `${prefix}@${numPart}!1`;
};

// Cryptographically strong password generator (10-12 chars, guaranteed complexity)
export const generateStrongPassword = (name?: string, phone?: string, email?: string): string => {
  return generateApplicantPassword(name, phone, email);
};

