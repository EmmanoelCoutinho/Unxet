import React from 'react';
import { PasswordInput } from './PasswordInput';
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}
export const Input: React.FC<InputProps> = ({
  label,
  error,
  className = '',
  type,
  ...props
}) => {
  const inputClassName = `w-full px-3 py-2 border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0A84FF] focus:border-transparent ${className} ${error ? 'border-red-500' : ''}`;
  return <div className="w-full">
      {label && <label className="block text-sm font-medium text-[#1E1E1E] mb-1">
          {label}
        </label>}
      {type === 'password' ? <PasswordInput className={inputClassName} {...props} /> : <input type={type} className={inputClassName} {...props} />}
      {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
    </div>;
};