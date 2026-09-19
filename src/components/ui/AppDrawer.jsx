import { Drawer } from 'vaul';
import { useEffect } from 'react';
import { registerBackButtonHandler } from '../../utils/backButton';

export default function AppDrawer({
  open,
  onOpenChange,
  trigger = null,
  title = '',
  description = '',
  children,
  headerRight = null,
  className = '',
  snapPoints,
  activeSnapPoint,
  setActiveSnapPoint,
}) {
  // Android hardware/gesture back button closes the drawer smoothly
  useEffect(() => {
    if (!open) return;
    return registerBackButtonHandler(() => {
      onOpenChange?.(false);
      return true;
    });
  }, [open, onOpenChange]);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      snapPoints={snapPoints}
      activeSnapPoint={activeSnapPoint}
      setActiveSnapPoint={setActiveSnapPoint}
      shouldScaleBackground={false}
    >
      {trigger && <Drawer.Trigger asChild>{trigger}</Drawer.Trigger>}
      <Drawer.Portal>
        <Drawer.Overlay className="vaul-drawer-overlay" />
        <Drawer.Content className={`vaul-drawer-content ${className}`}>
          <div className="vaul-drawer-handle" />
          {(title || headerRight) && (
            <div className="vaul-drawer-header">
              <div>
                {title && (
                  <Drawer.Title style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                    {title}
                  </Drawer.Title>
                )}
                {description && (
                  <Drawer.Description style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {description}
                  </Drawer.Description>
                )}
              </div>
              {headerRight}
            </div>
          )}
          <div className="vaul-drawer-body">
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
