"use client";

import React, { useState } from "react";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MedicalDocument } from "@/types/medical-document";

interface MedicalDocumentRenameDialogProps {
  document: MedicalDocument | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirmRename: (doc: MedicalDocument, newTitle: string) => void;
}

interface RenameFormProps {
  document: MedicalDocument;
  onClose: () => void;
  onConfirmRename: (doc: MedicalDocument, newTitle: string) => void;
}

function RenameForm({
  document,
  onClose,
  onConfirmRename,
}: RenameFormProps) {
  const [title, setTitle] = useState(document.title);
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Document title cannot be empty");
      return;
    }
    onConfirmRename(document, title.trim());
    onClose();
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2">
          <Pencil className="w-5 h-5" />
        </div>
        <DialogTitle className="text-lg font-bold">
          Rename Document
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground pt-1">
          Update the display title for &quot;{document.fileName}&quot;.
        </DialogDescription>
      </DialogHeader>

      <div className="py-4 space-y-2">
        <Label htmlFor="rename-input" className="text-xs font-medium">
          Document Title
        </Label>
        <Input
          id="rename-input"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (error) setError("");
          }}
          placeholder="Enter document title"
          className="text-sm"
          autoFocus
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!title.trim()}>
          Save Title
        </Button>
      </DialogFooter>
    </form>
  );
}

export function MedicalDocumentRenameDialog({
  document,
  isOpen,
  onClose,
  onConfirmRename,
}: MedicalDocumentRenameDialogProps) {
  if (!document) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-6">
        <RenameForm
          key={document.id}
          document={document}
          onClose={onClose}
          onConfirmRename={onConfirmRename}
        />
      </DialogContent>
    </Dialog>
  );
}
