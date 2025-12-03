import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MOCK_CHAPTERS, MOCK_FORMS } from "@/lib/data";
import { BarChart, Users, FileText, BookOpen, ArrowUpRight } from "lucide-react";

export default function Dashboard() {
  const totalChapters = MOCK_CHAPTERS.length;
  const totalForms = MOCK_FORMS.length;
  const totalSubmissions = MOCK_FORMS.reduce((acc, form) => acc + form.submissions, 0);

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground mt-2">Overview of your content and engagement.</p>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Chapters</CardTitle>
              <BookOpen className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalChapters}</div>
              <p className="text-xs text-muted-foreground">+1 from last month</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Forms</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalForms}</div>
              <p className="text-xs text-muted-foreground">+2 new this week</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Submissions</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalSubmissions}</div>
              <p className="text-xs text-muted-foreground">+12% from last month</p>
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity / Content */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <Card className="col-span-4">
            <CardHeader>
              <CardTitle>Recent Chapters</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {MOCK_CHAPTERS.slice(0, 3).map((chapter) => (
                  <div key={chapter.id} className="flex items-center justify-between p-4 border rounded-lg bg-muted/20">
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
              </div>
            </CardContent>
          </Card>
          
          <Card className="col-span-3">
            <CardHeader>
              <CardTitle>Top Forms</CardTitle>
            </CardHeader>
            <CardContent>
               <div className="space-y-4">
                {MOCK_FORMS.sort((a,b) => b.submissions - a.submissions).slice(0, 3).map((form) => (
                  <div key={form.id} className="flex items-center justify-between">
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
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
