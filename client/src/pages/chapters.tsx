import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Search, MoreHorizontal, Edit, Trash, Eye } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { chapterApi } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

export default function ChaptersPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newChapter, setNewChapter] = useState({
    title: "",
    description: "",
    status: "draft" as "draft" | "published" | "archived",
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
      setNewChapter({ title: "", description: "", status: "draft" });
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
    chapter.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCreate = () => {
    createMutation.mutate(newChapter);
  };

  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight" data-testid="text-chapters-title">Chapters</h2>
            <p className="text-muted-foreground mt-2">Manage your course content and curriculum.</p>
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
                  <div className={`text-xs px-2 py-1 rounded-full font-medium capitalize w-fit mb-2 ${
                         chapter.status === 'published' ? 'bg-green-100 text-green-700' :
                         chapter.status === 'draft' ? 'bg-amber-100 text-amber-700' :
                         'bg-slate-100 text-slate-700'
                       }`}>
                    {chapter.status}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" data-testid={`button-menu-${chapter.id}`}>
                        <MoreHorizontal size={16} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem><Eye className="mr-2 h-4 w-4" /> View Details</DropdownMenuItem>
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
                <CardTitle className="text-xl leading-tight">{chapter.title}</CardTitle>
                <CardDescription className="line-clamp-2 mt-2 h-10">
                  {chapter.description}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm text-muted-foreground border-t pt-4 mt-2">
                   <span>{chapter.formCount} Forms linked</span>
                   <span>Updated {new Date(chapter.updatedAt).toLocaleDateString()}</span>
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
        <DialogContent data-testid="dialog-create-chapter">
          <DialogHeader>
            <DialogTitle>Create New Chapter</DialogTitle>
            <DialogDescription>
              Add a new chapter to your course curriculum.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="Chapter title"
                value={newChapter.title}
                onChange={(e) => setNewChapter({ ...newChapter, title: e.target.value })}
                data-testid="input-chapter-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Brief description of the chapter"
                value={newChapter.description}
                onChange={(e) => setNewChapter({ ...newChapter, description: e.target.value })}
                data-testid="input-chapter-description"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select value={newChapter.status} onValueChange={(value: any) => setNewChapter({ ...newChapter, status: value })}>
                <SelectTrigger data-testid="select-chapter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newChapter.title || !newChapter.description} data-testid="button-submit-chapter">
              Create Chapter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
