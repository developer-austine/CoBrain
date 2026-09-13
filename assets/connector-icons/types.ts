import React from "react";

export interface ConnectorIconProps {
  size?: number;
  className?: string;
}

export interface ConnectorIconDefinition {
  id: string;
  label: string;
  category: "source" | "pipeline" | "ai";
  icon: React.FC<ConnectorIconProps>;
  color: string;
  bgColor: string;
}