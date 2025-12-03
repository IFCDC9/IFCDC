import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Plus, Search, Filter, MoreHorizontal, FileText, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { chapterApi, formApi } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

export default function FormsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newForm, setNewForm] = useState({
    title: "",
    chapterId: "",
    status: "active" as "active" | "closed",
  });

  const queryClient = useQueryClient();

  const { data: forms = [] } = useQuery({
    queryKey: ["forms"],
    queryFn: formApi.getAll,
  });

  const { data: chapters = [] } = useQuery({
    queryKey: ["chapters"],
    queryFn: chapterApi.getAll,
  });

  const createMutation = useMutation({
    mutationFn: formApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["forms"] });
      setIsCreateOpen(false);
      setNewForm({ title: "", chapterId: "", status: "active" });
      toast({ title: "Form created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create form", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: formApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["forms"] });
      toast({ title: "Form deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete form", description: error.message, variant: "destructive" });
    },
  });

  const filteredForms = forms.filter((form) =>
    form.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCreate = () => {
    createMutation.mutate(newForm);
  };

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight" data-testid="text-forms-title">Forms</h2>
            <p className="text-muted-foreground mt-2">Review submissions and manage form settings.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" data-testid="button-export">
              <Download size={16} />
              Export All
            </Button>
            <Button className="gap-2" onClick={() => setIsCreateOpen(true)} data-testid="button-new-form">
              <Plus size={16} />
              Create Form
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-4 bg-card p-4 rounded-lg border shadow-sm">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search forms..."
              className="pl-8 border-0 shadow-none focus-visible:ring-0"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="input-search-forms"
            />
          </div>
          <div className="h-8 w-[1px] bg-border mx-2" />
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
            <Filter size={16} />
            Filter
          </Button>
        </div>

        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Form Title</TableHead>
                <TableHead>Associated Chapter</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Submissions</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredForms.map((form) => {
                const chapter = chapters.find(c => c.id === form.chapterId);
                return (
                  <TableRow key={form.id} data-testid={`row-form-${form.id}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded bg-primary/10 text-primary">
                          <FileText size={16} />
                        </div>
                        {form.title}
                      </div>
                    </TableCell>
                    <TableCell>{chapter?.title || 'Unknown Chapter'}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${
                        form.status === 'active' 
                          ? 'bg-green-50 text-green-700 ring-green-600/20' 
                          : 'bg-gray-50 text-gray-600 ring-gray-500/10'
                      }`}>
                        {form.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right" data-testid={`text-submissions-${form.id}`}>{form.submissions}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-menu-${form.id}`}>
                            <MoreHorizontal size={16} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>View Submissions</DropdownMenuItem>
                          <DropdownMenuItem>Edit Form</DropdownMenuItem>
                          <DropdownMenuItem 
                            className="text-destructive"
                            onClick={() => deleteMutation.mutate(form.id)}
                            data-testid={`button-delete-${form.id}`}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredForms.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No forms found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent data-testid="dialog-create-form">
          <DialogHeader>
            <DialogTitle>Create New Form</DialogTitle>
            <DialogDescription>
              Add a new form and link it to a chapter.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Form Title</Label>
              <Input
                id="title"
                placeholder="Form title"
                value={newForm.title}
                onChange={(e) => setNewForm({ ...newForm, title: e.target.value })}
                data-testid="input-form-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chapter">Associated Chapter</Label>
              <Select value={newForm.chapterId} onValueChange={(value) => setNewForm({ ...newForm, chapterId: value })}>
                <SelectTrigger data-testid="select-form-chapter">
                  <SelectValue placeholder="Select a chapter" />
                </SelectTrigger>
                <SelectContent>
                  {chapters.map((chapter) => (
                    <SelectItem key={chapter.id} value={chapter.id}>
                      {chapter.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={newForm.status} onValueChange={(value: any) => setNewForm({ ...newForm, status: value })}>
                <SelectTrigger data-testid="select-form-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newForm.title || !newForm.chapterId} data-testid="button-submit-form">
              Create Form
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
