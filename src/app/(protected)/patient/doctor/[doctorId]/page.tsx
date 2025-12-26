
'use client'
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import BookTimeSlot from "@/components/patient/bookTimeSlot";
import { useUserStore } from "@/store/userStore";
import Avatar from "@/components/general/Avatar";
import type { Doctor } from "@/types/doctor";
import { 
  Star, 
  MapPin, 
  Briefcase, 
  DollarSign, 
  Mail, 
  User, 
  Calendar,
  Award,
  MessageCircle,
  Stethoscope
} from "lucide-react";
import { showToast } from "@/lib/toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function DoctorDetails() {
  const router = useRouter();
  const params = useParams();
  const doctorId = params.doctorId as string;
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [rating, setRating] = useState<{ average: number; count: number }>({ average: 0, count: 0 });
  const [comments, setComments] = useState<Array<any>>([]);
  const [newRating, setNewRating] = useState(5);
  const [ratedOnce, setRatedOnce] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [submittingRating, setSubmittingRating] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingChat, setStartingChat] = useState(false);
  const { user } = useUserStore();

  useEffect(() => {
    const fetchDoctor = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/doctors/${doctorId}`);
        if (!res.ok) {
          throw new Error("Failed to fetch doctor details");
        }
        const data = await res.json();
        if (!data.doctor) {
          throw new Error("Doctor data is missing from response");
        }
        setDoctor(data.doctor);
        setRating(data.rating ?? { average: 0, count: 0 });
        setComments(Array.isArray(data.comments) ? data.comments : []);

      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    if (doctorId) {
      fetchDoctor();
    }
  }, [doctorId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-linear-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center px-4 py-12">
        <Card className="w-full max-w-4xl">
          <CardContent className="p-12 text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-lg text-gray-600">Loading doctor details...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !doctor) {
    return (
      <div className="min-h-screen bg-linear-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center px-4 py-12">
        <Card className="w-full max-w-4xl border-red-200">
          <CardContent className="p-12 text-center">
            <div className="bg-red-100 rounded-full h-16 w-16 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">❌</span>
            </div>
            <p className="text-lg text-red-600">{error || "Doctor not found"}</p>
            <Button onClick={() => router.back()} variant="outline" className="mt-4">
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const startConversation = async () => {
    try {
      if (!user?.id) {
        showToast.warning("Please log in as a patient to start a chat.");
        return;
      }

      if (!doctor?.userId) {
        console.log(doctor);
        console.log(doctor?.age);
        showToast.warning("Doctor details are incomplete. Please try again.");

        return;
      }

      setStartingChat(true);

      const res = await fetch("/api/doctorpatientrelations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctorsUserId: doctor.userId,
          patientsUserId: user.id,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || "Failed to start conversation");
      }

      const data = await res.json();
      const relationId = data?.relation?.id;

      if (!relationId) {
        throw new Error("Missing relation id from server");
      }

      router.push(`/patient/chat/${relationId}`);
    } catch (err: any) {
      showToast.error(err?.message || "Could not start conversation. Please try again.");
    } finally {
      setStartingChat(false);
    }
  };

  const handleSubmitRating = async () => {
    if (!doctorId || ratedOnce) return;
    setSubmittingRating(true);
    try {
      const ratingRes = await fetch(`/api/doctors/${doctorId}/rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: newRating }),
      });
      const ratingData = await ratingRes.json();
      if (!ratingRes.ok) throw new Error(ratingData?.message || "Failed to submit rating");
      setRating(ratingData.rating ?? { average: 0, count: 0 });
      setRatedOnce(true);
    } catch (err: any) {
      showToast.error(err?.message || "Could not submit rating");
    } finally {
      setSubmittingRating(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!doctorId || !newComment.trim()) return;
    setSubmittingComment(true);
    try {
      const commentRes = await fetch(`/api/doctors/${doctorId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newComment }),
      });
      const commentData = await commentRes.json();
      if (!commentRes.ok) throw new Error(commentData?.message || "Failed to submit comment");

      if (commentData.comment) {
        setComments((prev) => [commentData.comment, ...prev]);
      }
      setNewComment("");
    } catch (err: any) {
      showToast.error(err?.message || "Could not submit comment");
    } finally {
      setSubmittingComment(false);
    }
  };



  return (
    <div className="min-h-screen bg-linear-to-br from-blue-50 via-white to-purple-50 py-8 px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Back Button */}
        <Button 
          onClick={() => router.back()} 
          variant="ghost" 
          className="mb-4"
        >
          ← Back to Search
        </Button>

        {/* Doctor Profile Header Card */}
        <Card className="overflow-hidden border-2 shadow-lg">
          <div className="bg-linear-to-r from-blue-600 to-purple-600 h-32"></div>
          <CardContent className="relative px-6 pb-6">
            {/* Avatar positioned over gradient */}
            <div className="flex flex-col md:flex-row gap-6 -mt-16">
              <div className="relative">
                <div className="ring-4 ring-white rounded-full">
                  <Avatar 
                    src={doctor.profileImageUrl} 
                    name={doctor.name || "Doctor"}
                    size="xl"
                    className="w-32 h-32"
                  />
                </div>
                <div className="absolute -bottom-2 -right-2 bg-green-500 rounded-full p-2 shadow-lg">
                  <Stethoscope className="w-6 h-6 text-white" />
                </div>
              </div>
              
              <div className="flex-1 mt-16 md:mt-0">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div>
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">
                      Dr. {doctor.name}
                    </h1>
                    <Badge variant="secondary" className="text-base px-4 py-1 mb-3">
                      <Award className="w-4 h-4 mr-2" />
                      {doctor.specialty}
                    </Badge>
                    
                    {/* Rating */}
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex items-center gap-1">
                        <StarRow value={rating.average} />
                      </div>
                      <span className="font-semibold text-lg text-gray-900">
                        {rating.average.toFixed(1)}
                      </span>
                      <span className="text-sm text-gray-500">
                        ({rating.count} {rating.count === 1 ? 'review' : 'reviews'})
                      </span>
                    </div>
                  </div>
                  
                  <Button 
                    onClick={startConversation}
                    disabled={startingChat}
                    size="lg"
                    className="bg-linear-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                  >
                    <MessageCircle className="w-5 h-5 mr-2" />
                    {startingChat ? "Starting..." : "Start Chat"}
                  </Button>
                </div>

                {/* Quick Info Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="bg-blue-100 p-2 rounded-lg">
                      <Briefcase className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">Experience</p>
                      <p className="font-semibold">{doctor.experience} years</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 text-sm">
                    <div className="bg-green-100 p-2 rounded-lg">
                      <DollarSign className="w-4 h-4 text-green-600" />
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">Consultation</p>
                      <p className="font-semibold">₹{doctor.fees}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 text-sm">
                    <div className="bg-purple-100 p-2 rounded-lg">
                      <User className="w-4 h-4 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">Gender</p>
                      <p className="font-semibold">{doctor.gender}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 text-sm">
                    <div className="bg-orange-100 p-2 rounded-lg">
                      <Calendar className="w-4 h-4 text-orange-600" />
                    </div>
                    <div>
                      <p className="text-gray-500 text-xs">Age</p>
                      <p className="font-semibold">{doctor.age} years</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* About & Details Section */}
        <div className="grid md:grid-cols-3 gap-6">
          {/* About Doctor - Takes 2 columns */}
          <Card className="md:col-span-2 shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="bg-blue-100 p-2 rounded-lg">
                  <User className="w-5 h-5 text-blue-600" />
                </div>
                About Dr. {doctor.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {doctor.doctorBio ? (
                <p className="text-gray-700 leading-relaxed">{doctor.doctorBio}</p>
              ) : (
                <p className="text-gray-500 italic">No bio available yet.</p>
              )}
              
              {doctor.qualifications && doctor.qualifications.length > 0 && (
                <div className="pt-4 border-t">
                  <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <Award className="w-5 h-5 text-blue-600" />
                    Qualifications
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {doctor.qualifications.map((qual) => (
                      <Badge key={qual} variant="outline" className="text-sm">
                        {qual}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Contact Info Card */}
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="bg-purple-100 p-2 rounded-lg">
                  <Mail className="w-5 h-5 text-purple-600" />
                </div>
                Contact Info
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-gray-400 mt-1 shrink-0" />
                  <div>
                    <p className="text-sm text-gray-500">Location</p>
                    <p className="font-medium">{doctor.city}, {doctor.state}</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-3">
                  <Mail className="w-5 h-5 text-gray-400 mt-1 shrink-0" />
                  <div>
                    <p className="text-sm text-gray-500">Email</p>
                    <a 
                      href={`mailto:${doctor.email}`} 
                      className="font-medium text-blue-600 hover:underline break-all"
                    >
                      {doctor.email}
                    </a>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Book Appointment Section */}
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="bg-green-100 p-2 rounded-lg">
                <Calendar className="w-5 h-5 text-green-600" />
              </div>
              Book an Appointment
            </CardTitle>
            <p className="text-sm text-gray-500">Select a convenient time slot</p>
          </CardHeader>
          <CardContent>
            <BookTimeSlot doctorId={doctorId}/>
          </CardContent>
        </Card>

        {/* Rating & Review Section */}
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="bg-yellow-100 p-2 rounded-lg">
                <Star className="w-5 h-5 text-yellow-600" />
              </div>
              Leave a Rating & Review
            </CardTitle>
            <p className="text-sm text-gray-500">Share your experience with this doctor</p>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Rating Section */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-700 mb-2">Your Rating</p>
                  <StarInput value={newRating} onChange={setNewRating} disabled={ratedOnce} />
                  <p className="text-xs text-gray-500 mt-1">{newRating} out of 5 stars</p>
                </div>
                <Button
                  onClick={handleSubmitRating}
                  disabled={ratedOnce || submittingRating}
                  variant={ratedOnce ? "outline" : "default"}
                  className={ratedOnce ? "" : "bg-blue-600 hover:bg-blue-700"}
                >
                  {ratedOnce ? "✓ Rated" : submittingRating ? "Submitting..." : "Submit Rating"}
                </Button>
              </div>
            </div>

            {/* Comment Section */}
            <div>
              <label htmlFor="comment" className="text-sm font-medium text-gray-700 mb-2 block">
                Your Review
              </label>
              <textarea
                id="comment"
                className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                rows={4}
                placeholder="Share your experience with this doctor. What did you like? How was the consultation?"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
              />
              <div className="mt-3 flex justify-between items-center">
                <p className="text-xs text-gray-500">{newComment.length} characters</p>
                <Button
                  onClick={handleSubmitComment}
                  disabled={submittingComment || !newComment.trim()}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {submittingComment ? "Posting..." : "Post Review"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Reviews Section */}
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="bg-indigo-100 p-2 rounded-lg">
                  <MessageCircle className="w-5 h-5 text-indigo-600" />
                </div>
                Patient Reviews
              </div>
              <Badge variant="secondary">{comments.length} {comments.length === 1 ? 'review' : 'reviews'}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {comments.length === 0 ? (
              <div className="text-center py-12">
                <div className="bg-gray-100 rounded-full h-16 w-16 flex items-center justify-center mx-auto mb-4">
                  <MessageCircle className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-gray-500">No reviews yet</p>
                <p className="text-sm text-gray-400 mt-1">Be the first to share your experience!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {comments.map((c) => (
                  <CommentItem key={c.id} comment={c} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StarInput({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => !disabled && onChange(i)}
          className={`text-3xl leading-none focus:outline-none transition-all transform hover:scale-110 ${
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
          }`}
          disabled={disabled}
          aria-label={`Rate ${i} star${i === 1 ? "" : "s"}`}
        >
          <Star 
            className={`w-8 h-8 ${
              i <= value 
                ? 'fill-yellow-400 text-yellow-400' 
                : 'text-gray-300'
            }`}
          />
        </button>
      ))}
    </div>
  );
}

function CommentItem({ comment }: { comment: any }) {
  const date = new Date(comment.createdAt);
  const formattedDate = date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow bg-white">
      <div className="flex gap-4">
        <Avatar 
          src={comment.user?.profileImageUrl} 
          name={comment.user?.name || "User"} 
          size="md"
        />
        <div className="flex-1">
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="font-semibold text-gray-900">{comment.user?.name || "Anonymous User"}</p>
              <p className="text-xs text-gray-500">{formattedDate}</p>
            </div>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">{comment.text}</p>
        </div>
      </div>
    </div>
  );
}

function StarRow({ value }: { value: number }) {
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  return (
    <div className="flex items-center gap-1 text-yellow-500">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`w-5 h-5 ${i <= full ? "fill-yellow-500 stroke-yellow-500" : half && i === full + 1 ? "fill-yellow-200 stroke-yellow-400" : "stroke-yellow-400"}`}
        />
      ))}
    </div>
  );
}