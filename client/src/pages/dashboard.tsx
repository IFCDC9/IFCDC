import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Users, FileText, BookOpen, ArrowUpRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { chapterApi, formApi } from "@/lib/api";

export default function Dashboard() {
  const { data: chapters = [] } = useQuery({
    queryKey: ["chapters"],
    queryFn: chapterApi.getAll,
  });

  const { data: forms = [] } = useQuery({
    queryKey: ["forms"],
    queryFn: formApi.getAll,
  });

  const totalChapters = chapters.length;
  const totalForms = forms.length;
  const totalSubmissions = forms.reduce((acc, form) => acc + form.submissions, 0);

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight" data-testid="text-dashboard-title">Dashboard</h2>
          <p className="text-muted-foreground mt-2">Overview of your content and engagement.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Chapters</CardTitle>
              <BookOpen className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-chapters">{totalChapters}</div>
              <p className="text-xs text-muted-foreground">+1 from last month</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Forms</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-forms">{totalForms}</div>
              <p className="text-xs text-muted-foreground">+2 new this week</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Submissions</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-submissions">{totalSubmissions}</div>
              <p className="text-xs text-muted-foreground">+12% from last month</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <Card className="col-span-4">
            <CardHeader>
              <CardTitle>Recent Chapters</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {chapters.slice(0, 3).map((chapter) => (
                  <div key={chapter.id} className="flex items-center justify-between p-4 border rounded-lg bg-muted/20" data-testid={`card-chapter-${chapter.id}`}>
                    <div className="space-y-1">
                      <p className="font-medium leading-none">{chapter.title}</p>
                      <p className="text-sm text-muted-foreground line-clamp-1">{chapter.description}</p>
                    </div>
                    <div className="flex items-center gap-2">
                       <span className={`text-xs px-2 py-1 rounded-full capitalize ${
                         chapter.status === 'published' ? 'bg-green-100 text-green-700' :
                         chapter.status === 'draft' ? 'bg-yellow-100 text-yellow-700' :
                         'bg-gray-100 text-gray-700'
                       }`}>
                         {chapter.status}
                       </span>
                    </div>
                  </div>
                ))}
                {chapters.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">No chapters yet</p>
                )}
              </div>
            </CardContent>
          </Card>
          
          <Card className="col-span-3">
            <CardHeader>
              <CardTitle>Top Forms</CardTitle>
            </CardHeader>
            <CardContent>
               <div className="space-y-4">
                {forms.sort((a,b) => b.submissions - a.submissions).slice(0, 3).map((form) => (
                  <div key={form.id} className="flex items-center justify-between" data-testid={`row-form-${form.id}`}>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary">
                        <FileText size={14} />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium leading-none">{form.title}</p>
                        <p className="text-xs text-muted-foreground">{form.submissions} submissions</p>
                      </div>
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                ))}
                {forms.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">No forms yet</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
