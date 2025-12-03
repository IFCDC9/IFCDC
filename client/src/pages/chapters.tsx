import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MOCK_CHAPTERS } from "@/lib/data";
import { Plus, Search, MoreHorizontal, Edit, Trash, Eye } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function ChaptersPage() {
  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Chapters</h2>
            <p className="text-muted-foreground mt-2">Manage your course content and curriculum.</p>
          </div>
          <Button className="shrink-0 gap-2">
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
            />
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {MOCK_CHAPTERS.map((chapter) => (
            <Card key={chapter.id} className="group hover:shadow-md transition-all duration-300 border-border/60">
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
                      <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreHorizontal size={16} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem><Eye className="mr-2 h-4 w-4" /> View Details</DropdownMenuItem>
                      <DropdownMenuItem><Edit className="mr-2 h-4 w-4" /> Edit Chapter</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive"><Trash className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>
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
        </div>
      </div>
    </Layout>
  );
}
