import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Search, MoreHorizontal, Edit, Trash, Eye, CheckCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { chapterApi } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

export default function ChaptersPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newChapter, setNewChapter] = useState({
    number: 1,
    title: "",
    section: "",
    slug: "",
    body: "",
    isActive: true,
  });

  const queryClient = useQueryClient();

  const { data: chapters = [] } = useQuery({
    queryKey: ["chapters"],
    queryFn: chapterApi.getAll,
  });

  const createMutation = useMutation({
    mutationFn: chapterApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters"] });
      setIsCreateOpen(false);
      setNewChapter({ number: 1, title: "", section: "", slug: "", body: "", isActive: true });
      toast({ title: "Chapter created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create chapter", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: chapterApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chapters"] });
      toast({ title: "Chapter deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete chapter", description: error.message, variant: "destructive" });
    },
  });

  const filteredChapters = chapters.filter((chapter) =>
    chapter.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    chapter.section.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCreate = () => {
    createMutation.mutate(newChapter);
  };

  const generateSlug = (title: string) => {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  };

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight" data-testid="text-chapters-title">Policy Chapters</h2>
            <p className="text-muted-foreground mt-2">Manage policy content and track acknowledgements.</p>
          </div>
          <Button className="shrink-0 gap-2" onClick={() => setIsCreateOpen(true)} data-testid="button-new-chapter">
            <Plus size={16} />
            New Chapter
          </Button>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search chapters..."
              className="pl-8 bg-card"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-testid="input-search-chapters"
            />
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filteredChapters.map((chapter) => (
            <Card key={chapter.id} className="group hover:shadow-md transition-all duration-300 border-border/60" data-testid={`card-chapter-${chapter.id}`}>
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-muted-foreground">Ch. {chapter.number}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted">{chapter.section}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      chapter.isActive 
                        ? 'bg-green-100 text-green-700' 
                        : 'bg-gray-100 text-gray-700'
                    }`}>
                      {chapter.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" data-testid={`button-menu-${chapter.id}`}>
                        <MoreHorizontal size={16} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem><Eye className="mr-2 h-4 w-4" /> View Content</DropdownMenuItem>
                      <DropdownMenuItem><Edit className="mr-2 h-4 w-4" /> Edit Chapter</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        className="text-destructive"
                        onClick={() => deleteMutation.mutate(chapter.id)}
                        data-testid={`button-delete-${chapter.id}`}
                      >
                        <Trash className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <CardTitle className="text-xl leading-tight mt-2">{chapter.title}</CardTitle>
                <CardDescription className="line-clamp-2 mt-2 h-10">
                  {chapter.body.substring(0, 100)}...
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm text-muted-foreground border-t pt-4 mt-2">
                   <div className="flex items-center gap-1">
                     <CheckCircle size={14} className="text-green-600" />
                     <span>{chapter.acknowledgementCount} acknowledged</span>
                   </div>
                   <span>v{chapter.version}</span>
                </div>
              </CardContent>
            </Card>
          ))}
          {filteredChapters.length === 0 && (
            <div className="col-span-full text-center py-12 text-muted-foreground">
              No chapters found
            </div>
          )}
        </div>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-lg" data-testid="dialog-create-chapter">
          <DialogHeader>
            <DialogTitle>Create New Chapter</DialogTitle>
            <DialogDescription>
              Add a new policy chapter for users to acknowledge.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="number">Chapter Number</Label>
                <Input
                  id="number"
                  type="number"
                  min={1}
                  value={newChapter.number}
                  onChange={(e) => setNewChapter({ ...newChapter, number: parseInt(e.target.value) || 1 })}
                  data-testid="input-chapter-number"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="section">Section</Label>
                <Input
                  id="section"
                  placeholder="e.g., HR Policies"
                  value={newChapter.section}
                  onChange={(e) => setNewChapter({ ...newChapter, section: e.target.value })}
                  data-testid="input-chapter-section"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="Chapter title"
                value={newChapter.title}
                onChange={(e) => setNewChapter({ 
                  ...newChapter, 
                  title: e.target.value,
                  slug: generateSlug(e.target.value)
                })}
                data-testid="input-chapter-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                placeholder="url-friendly-slug"
                value={newChapter.slug}
                onChange={(e) => setNewChapter({ ...newChapter, slug: e.target.value })}
                data-testid="input-chapter-slug"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="body">Content</Label>
              <Textarea
                id="body"
                placeholder="Full policy content..."
                className="min-h-[150px]"
                value={newChapter.body}
                onChange={(e) => setNewChapter({ ...newChapter, body: e.target.value })}
                data-testid="input-chapter-body"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="isActive">Active</Label>
              <Switch
                id="isActive"
                checked={newChapter.isActive}
                onCheckedChange={(checked) => setNewChapter({ ...newChapter, isActive: checked })}
                data-testid="switch-chapter-active"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleCreate} 
              disabled={!newChapter.title || !newChapter.section || !newChapter.slug || !newChapter.body} 
              data-testid="button-submit-chapter"
            >
              Create Chapter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
