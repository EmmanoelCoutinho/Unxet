import React from 'react';
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}
export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles = 'font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2';
  const variants = {
    primary: 'bg-[#0A84FF] text-white hover:bg-[#0A84FF]/90 focus:ring-[#0A84FF]',
    secondary: 'bg-[#003366] text-white hover:bg-[#003366]/90 focus:ring-[#003366]',
    ghost: 'bg-transparent text-gray-900 hover:bg-gray-200 focus:ring-gray-200'
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg'
  };
  return <button className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className} ${disabled || isLoading ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={disabled || isLoading} {...props}>
      {isLoading ? 'Carregando...' : children}
    </button>;
};