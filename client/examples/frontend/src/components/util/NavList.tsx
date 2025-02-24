import React from 'react';

export type NavOption =
  | {
      label: string;
      component?: JSX.Element;
    }
  | 'divider';

type NavListProps = {
  navOptions: NavOption[];
  selectedNavItem: number;
  onClick: (index: number) => void;
};

// Tab Component
export const NavList: React.FC<NavListProps> = ({ navOptions, selectedNavItem, onClick }) => {
  return (
    <ul>
      {navOptions.map((option, index) =>
        option === 'divider' ? (
          <div key={index} className="divider" />
        ) : !!option.component ? (
          <li key={index} className={selectedNavItem === index ? 'active' : ''} onClick={() => onClick(index)}>
            {option.label}
          </li>
        ) : (
          <h3 key={index}>{option.label}</h3>
        ),
      )}
    </ul>
  );
};
