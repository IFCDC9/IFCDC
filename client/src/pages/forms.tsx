import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { MOCK_FORMS, MOCK_CHAPTERS } from "@/lib/data";
import { Plus, Search, Filter, MoreHorizontal, FileText, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
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

export default function FormsPage() {
  return (
    <Layout>
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Forms</h2>
            <p className="text-muted-foreground mt-2">Review submissions and manage form settings.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2">
              <Download size={16} />
              Export All
            </Button>
            <Button className="gap-2">
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
              {MOCK_FORMS.map((form) => {
                const chapter = MOCK_CHAPTERS.find(c => c.id === form.chapterId);
                return (
                  <TableRow key={form.id}>
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
                    <TableCell className="text-right">{form.submissions}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal size={16} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>View Submissions</DropdownMenuItem>
                          <DropdownMenuItem>Edit Form</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </Layout>
  );
}
