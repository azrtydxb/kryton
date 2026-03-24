import { FileNode } from '../../lib/api';
import { TemplatePicker } from '../Templates/TemplatePicker';
import { QuickSwitcher } from '../QuickSwitcher/QuickSwitcher';
import { ShareDialog } from '../Sharing/ShareDialog';
import { AccessRequestsModal } from '../Sharing/AccessRequestsModal';
import AdminPage from '../../pages/AdminPage';

interface ModalsContainerProps {
  showTemplatePicker: boolean;
  showQuickSwitcher: boolean;
  showAdmin: boolean;
  showShareDialog: boolean;
  showAccessRequests: boolean;
  shareTarget: { path: string; isFolder: boolean } | null;
  noteTree: FileNode[];
  onTemplateSelected: (content: string) => void;
  onCloseTemplatePicker: () => void;
  onNoteSelect: (path: string) => void;
  onCloseQuickSwitcher: () => void;
  onCloseAdmin: () => void;
  onCloseShareDialog: () => void;
  onCloseAccessRequests: () => void;
}

export function ModalsContainer({
  showTemplatePicker, showQuickSwitcher, showAdmin,
  showShareDialog, showAccessRequests, shareTarget, noteTree,
  onTemplateSelected, onCloseTemplatePicker,
  onNoteSelect, onCloseQuickSwitcher,
  onCloseAdmin, onCloseShareDialog, onCloseAccessRequests,
}: ModalsContainerProps) {
  return (
    <>
      {showTemplatePicker && (
        <TemplatePicker onSelect={onTemplateSelected} onClose={onCloseTemplatePicker} noteTitle="New Note" />
      )}
      {showQuickSwitcher && (
        <QuickSwitcher notes={noteTree} onSelect={onNoteSelect} onClose={onCloseQuickSwitcher} />
      )}
      {showAdmin && <AdminPage onClose={onCloseAdmin} />}
      {showShareDialog && shareTarget && (
        <ShareDialog notePath={shareTarget.path} isFolder={shareTarget.isFolder} onClose={onCloseShareDialog} />
      )}
      {showAccessRequests && <AccessRequestsModal onClose={onCloseAccessRequests} />}
    </>
  );
}
