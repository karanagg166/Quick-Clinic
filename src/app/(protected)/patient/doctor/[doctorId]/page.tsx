
'use client'
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import BookTimeSlot from "@/components/patient/bookTimeSlot";
import { useUserStore } from "@/store/userStore";
import Avatar from "@/components/general/Avatar";
import type { Doctor } from "@/types/doctor";
import { Star } from "lucide-react";
import { showToast } from "@/lib/toast";

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
      <div className="max-w-3xl mx-auto p-6">
        <p className="text-center text-gray-600">Loading doctor details...</p>
      </div>
    );
  }

  if (error || !doctor) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <p className="text-center text-red-600">{error || "Doctor not found"}</p>
      </div>
    );
  }

  const startConversation = async () => {
    try {
      if (!user?.userId) {
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
          patientsUserId: user.userId,
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
    <>
      <div className="max-w-3xl mx-auto p-6 shadow rounded">
        <h2 className="text-2xl font-bold mb-6">Doctor Details</h2>
        
        {/* Doctor Information Section with Avatar */}
        <div className="mb-6 bg-linear-to-r from-blue-50 to-blue-100 p-6 rounded-lg border border-blue-200">
          <div className="flex gap-6 items-start">
            <Avatar 
              src={doctor.profileImageUrl} 
              name={doctor.name || "Doctor"}
              size="xl"
            />
            <div className="flex-1">
              <h3 className="text-3xl font-semibold mb-1">Dr. {doctor.name}</h3>
              <p className="text-lg text-blue-700 font-medium mb-4">{doctor.specialty}</p>

              {/* Ratings summary */}
              <div className="flex items-center gap-2 mb-3">
                <StarRow value={rating.average} />
                <span className="text-sm text-gray-700">{rating.average.toFixed(1)} / 5</span>
                <span className="text-xs text-gray-500">({rating.count} ratings)</span>
              </div>
              
              <div className="grid grid-cols-2 gap-3 text-sm">
                <p className="text-gray-700"><strong>Age:</strong> {doctor.age}</p>
                <p className="text-gray-700"><strong>Gender:</strong> {doctor.gender}</p>
                <p className="text-gray-700"><strong>Experience:</strong> {doctor.experience} years</p>
                <p className="text-gray-700"><strong>Fees:</strong> ₹{doctor.fees}</p>
                <p className="text-gray-700"><strong>Location:</strong> {doctor.city}, {doctor.state}</p>
                <p className="text-gray-700"><strong>Email:</strong> 
                  <a href={`mailto:${doctor.email}`} className="text-blue-600 hover:underline ml-1">{doctor.email}</a>
                </p>
              </div>
            </div>
          </div>
        </div>
        {/* Book appointment section */}
        <BookTimeSlot doctorId={doctorId}/>
        </div>

        {/* Submit rating & comment */}
        <div className="max-w-3xl mx-auto p-6 mt-6 bg-white border border-gray-200 rounded-lg shadow-sm space-y-4">
          <h3 className="text-xl font-semibold text-gray-900">Leave a rating & review</h3>

          <div className="flex items-center gap-3">
            <StarInput value={newRating} onChange={setNewRating} disabled={ratedOnce} />
            <span className="text-sm text-gray-700">{newRating} / 5</span>
            <button
              onClick={handleSubmitRating}
              disabled={ratedOnce || submittingRating}
              className="px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-60"
            >
              {ratedOnce ? "Rated" : submittingRating ? "Submitting..." : "Submit rating"}
            </button>
          </div>

          <div>
            <textarea
              className="w-full border rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              placeholder="Share your experience..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
            />
            <div className="mt-3 flex justify-end">
              <button
                onClick={handleSubmitComment}
                disabled={submittingComment || !newComment.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-60"
              >
                {submittingComment ? "Submitting..." : "Post comment"}
              </button>
            </div>
          </div>
        </div>

        {/* Comments section */}
        <div className="max-w-3xl mx-auto p-6 mt-6 bg-white border border-gray-200 rounded-lg shadow-sm">
          <h3 className="text-xl font-semibold text-gray-900 mb-3">Reviews & Comments</h3>
          {comments.length === 0 && (
            <p className="text-sm text-gray-600">No comments yet.</p>
          )}
          <div className="space-y-4">
            {comments.map((c) => (
              <CommentItem key={c.id} comment={c} />
            ))}
          </div>
        </div>

        <div className="max-w-3xl mx-auto p-6 mt-6 bg-blue-50 border border-blue-100 rounded-lg shadow-sm">
          <h3 className="text-xl font-semibold text-blue-800 mb-2">Have questions?</h3>
          <p className="text-sm text-blue-900 mb-3">
            Start a conversation with the doctor to clarify symptoms, medications, or next steps.
          </p>
          <div className="flex flex-wrap gap-3 text-sm text-blue-900">
            <button
              type="button"
              onClick={startConversation}
              disabled={startingChat}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md shadow hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {startingChat ? "Starting..." : "💬 Start real-time chat"}
            </button>
          </div>
        </div>
        </>

        
    );
}

function StarInput({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-1 text-yellow-500">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => !disabled && onChange(i)}
          className="text-2xl leading-none focus:outline-none"
          disabled={disabled}
          aria-label={`Rate ${i} star${i === 1 ? "" : "s"}`}
        >
          {i <= value ? "★" : "☆"}
        </button>
      ))}
    </div>
  );
}

function CommentItem({ comment }: { comment: any }) {
  return (
    <div className="border rounded-lg p-4">
      <div className="flex gap-3 items-start">
        <Avatar src={comment.user?.profileImageUrl} name={comment.user?.name || "User"} size="sm" />
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-gray-900">{comment.user?.name || "User"}</p>
            <span className="text-xs text-gray-500">{new Date(comment.createdAt).toLocaleString()}</span>
          </div>
          <p className="text-sm text-gray-700 mt-1">{comment.text}</p>
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