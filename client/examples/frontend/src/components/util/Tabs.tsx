import React, { ReactNode, useState } from 'react';
import './Tabs.css';

// Define a type for the Tab props
type TabProps = {
  label: string;
  children?: ReactNode;
  activeTab?: number;
  index?: number;
  onClick?: (index: number) => void;
};

// Tab Component
export const Tab: React.FC<TabProps> = ({ label, activeTab, index, onClick }) => {
  return (
    <button className={`tab ${activeTab === index ? 'active' : ''}`} onClick={() => onClick!(index!)}>
      {label}
    </button>
  );
};

// Define a type for the Tabs props
type TabsProps = {
  children: React.ReactElement<TabProps>[];
  onSelectionChanged: (index: number) => void;
};

// Tabs Component
export const Tabs: React.FC<TabsProps> = ({ children, onSelectionChanged }) => {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div>
      <div className="tabs">
        {children.map((child, index) => {
          return React.cloneElement(child, {
            index,
            activeTab,
            onClick: (i: number) => {
              setActiveTab(i);
              onSelectionChanged(i);
            },
          });
        })}
      </div>
      <div>{children[activeTab].props.children}</div>
    </div>
  );
};
