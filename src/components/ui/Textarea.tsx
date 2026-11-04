import React from "react";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea: React.FC<TextareaProps> = ({
  label,
  error,
  className = "",
  ...props
}) => {
  return (
    <div className="w-full">
      {label ? (
        <label className="block text-sm font-medium text-gray-900 mb-1">
          {label}
        </label>
      ) : null}
      <textarea
        className={[
          "w-full px-3 py-2 border border-gray-200 rounded-lg",
          "focus:outline-none focus:ring-2 focus:ring-[#0A84FF] focus:border-transparent",
          "min-h-[96px] resize-y",
          error ? "border-red-500" : "",
          className,
        ].join(" ")}
        {...props}
      />
      {error ? <p className="mt-1 text-sm text-red-500">{error}</p> : null}
    </div>
  );
};

