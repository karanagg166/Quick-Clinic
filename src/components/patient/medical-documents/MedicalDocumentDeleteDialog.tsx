"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MedicalDocument } from "@/types/medical-document";

interface MedicalDocumentDeleteDialogProps {
  document: MedicalDocument | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirmDelete: (doc: MedicalDocument) => void;
}

export function MedicalDocumentDeleteDialog({
  document,
  isOpen,
  onClose,
  onConfirmDelete,
}: MedicalDocumentDeleteDialogProps) {
  if (!document) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-6">
        <DialogHeader>
          <div className="mx-auto sm:mx-0 w-10 h-10 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mb-2">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <DialogTitle className="text-lg font-bold">
            Delete Medical Document?
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground pt-1">
            Are you sure you want to remove{" "}
            <strong className="text-foreground font-semibold">
              &quot;{document.title}&quot;
            </strong>
            ? This action will remove the document from your list.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-0 mt-4">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              onConfirmDelete(document);
              onClose();
            }}
          >
            Delete Document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
