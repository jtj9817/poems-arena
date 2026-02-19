import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost';
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  fullWidth = false,
  className = '',
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center font-serif font-semibold tracking-wider uppercase text-sm px-8 py-3 transition-all duration-300 ease-out active:scale-[0.98]';

  const variants = {
    primary: 'bg-ink text-paper border border-ink hover:bg-opacity-90',
    outline: 'bg-transparent text-ink border border-ink hover:bg-ink hover:text-paper',
    ghost: 'bg-transparent text-pencil hover:text-ink border border-transparent',
  };

  const widthStyle = fullWidth ? 'w-full' : '';

  return (
    <button className={`${baseStyles} ${variants[variant]} ${widthStyle} ${className}`} {...props}>
      {children}
    </button>
  );
};
