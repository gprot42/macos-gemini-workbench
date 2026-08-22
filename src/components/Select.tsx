import { SelectHTMLAttributes, forwardRef } from "react";

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOption[];
}

function OptionList({ options }: { options: SelectOption[] }) {
  return (
    <>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </>
  );
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", label, options, ...props }, ref) => {
    const groups: { name: string; options: SelectOption[] }[] = [];
    for (const option of options) {
      const name = option.group || "";
      const last = groups[groups.length - 1];
      if (last && last.name === name) {
        last.options.push(option);
      } else {
        groups.push({ name, options: [option] });
      }
    }

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label className="text-base text-gray-600 dark:text-tokyo-muted">
            {label}
          </label>
        )}
        <select
          ref={ref}
          className={`px-3 py-2 bg-white dark:bg-tokyo-surface border border-gray-200 dark:border-tokyo-border rounded-lg text-gray-700 dark:text-tokyo-text text-base focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent cursor-pointer ${className}`}
          {...props}
        >
          {groups.map((group, i) =>
            group.name ? (
              <optgroup key={`${group.name}-${i}`} label={group.name}>
                <OptionList options={group.options} />
              </optgroup>
            ) : (
              <OptionList key={`ungrouped-${i}`} options={group.options} />
            )
          )}
        </select>
      </div>
    );
  }
);

Select.displayName = "Select";
