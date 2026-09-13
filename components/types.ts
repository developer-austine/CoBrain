export type SideNavItem = {
    title: string;
    path: string;
    icon?: string;
    subMenu?: boolean
    subMenuItems?: SideNavItem[];
}