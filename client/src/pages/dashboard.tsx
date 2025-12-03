import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, FileText, BookOpen, CheckCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { chapterApi, userApi, acknowledgementApi } from "@/lib/api";

export default function Dashboard() {
  const { data: chapters = [] } = useQuery({
    queryKey: ["chapters"],
    queryFn: chapterApi.getAll,
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: userApi.getAll,
  });

  const totalChapters = chapters.length;
  const activeChapters = chapters.filter(c => c.isActive).length;
  const totalUsers = users.length;
  const totalAcknowledgements = chapters.reduce((acc, c) => acc + c.acknowledgementCount, 0);

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight" data-testid="text-dashboard-title">Dashboard</h2>
          <p className="text-muted-foreground mt-2">Policy acknowledgement overview and tracking.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Chapters</CardTitle>
              <BookOpen className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-chapters">{totalChapters}</div>
              <p className="text-xs text-muted-foreground">{activeChapters} active</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-users">{totalUsers}</div>
              <p className="text-xs text-muted-foreground">Staff members</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Acknowledgements</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-acks">{totalAcknowledgements}</div>
              <p className="text-xs text-muted-foreground">Total recorded</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Compliance</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-compliance">
                {totalUsers > 0 && totalChapters > 0 
                  ? Math.round((totalAcknowledgements / (totalUsers * activeChapters)) * 100) || 0
                  : 0}%
              </div>
              <p className="text-xs text-muted-foreground">Overall rate</p>
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
                {chapters.slice(0, 5).map((chapter) => (
                  <div key={chapter.id} className="flex items-center justify-between p-4 border rounded-lg bg-muted/20" data-testid={`card-chapter-${chapter.id}`}>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">Ch. {chapter.number}</span>
                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted">{chapter.section}</span>
                      </div>
                      <p className="font-medium leading-none">{chapter.title}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm font-medium">{chapter.acknowledgementCount}</p>
                        <p className="text-xs text-muted-foreground">acknowledged</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        chapter.isActive 
                          ? 'bg-green-100 text-green-700' 
                          : 'bg-gray-100 text-gray-700'
                      }`}>
                        {chapter.isActive ? 'Active' : 'Inactive'}
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
              <CardTitle>Recent Users</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {users.slice(0, 5).map((user) => (
                  <div key={user.id} className="flex items-center justify-between" data-testid={`row-user-${user.id}`}>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-medium text-sm">
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium leading-none">{user.name}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full capitalize ${
                      user.role === 'admin' ? 'bg-purple-100 text-purple-700' :
                      user.role === 'director' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {user.role}
                    </span>
                  </div>
                ))}
                {users.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">No users yet</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
